/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  CORE_COMPONENT_DESCRIPTORS,
  CausalComputation,
  CausalOwner,
  Pressable,
  Text,
  View,
} from "@solid-native/core";
import type {
  HostCommitFrameEvent,
  HostCommitMountedEvent,
} from "@solid-native/host-contract";
import {
  requestJSON,
  type NetworkJSONValue,
} from "@solid-native/networking/json";
import {
  createReactNativeNetworkService,
  NetworkRequestCancelledError,
  NetworkTransportError,
  type NetworkResponse,
  type NetworkTextRequestHandle,
} from "@solid-native/networking/react-native";
import type { ServerEvent } from "@solid-native/networking/server-events";
import {
  createNetworkController,
  NetworkOwnerDisposedError,
} from "@solid-native/networking/solid";
import { createServerEventStream } from "@solid-native/networking/solid-server-events";
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";
import { getReactNativePlatformServices } from "@solid-native/runtime/react-native";

const ANDROID_DEVICE_SERVER_ORIGIN = "http://127.0.0.1:38473";
const IOS_PROOF_DEEP_LINK_PREFIX =
  "dev.solidnative.networking://networking/proof?origin=";
const IOS_LOCAL_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/u;
const IOS_RUN_PATH = /^\/[a-f0-9]{36}$/u;
const READY_TEXT = "Solid Native networking ready";
const RUN_LABEL = "Run native networking protocol proof";
const RESPONSE_TEXT = "Native response metadata received";
const SSE_TEXT = "Native SSE event reached Solid";
const JSON_TEXT = "Native JSON completion reached Solid";
const COMPLETE_TEXT =
  "Networking proof complete (2 SSE events, JSON 2, failure, cancellation)";
const START_DISPOSAL_LABEL = "Start owner-disposal network request";
const DISPOSAL_ACTIVE_TEXT = "Owner-disposal request active";
const DISPOSE_LABEL = "Dispose active networking owner";
const OUTPUT_COMPUTATION_NAME = "platform.network.output";
const PROOF_TIMEOUT_MS = 10_000;

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_NETWORKING_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isPrivateIPv4Address(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;
  const values = octets.map((octet) => Number(octet));
  if (
    values.some(
      (value, index) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255 ||
        String(value) !== octets[index],
    )
  ) {
    return false;
  }
  const first = values[0];
  const second = values[1];
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function parseIOSNetworkingProofOrigin(initialURL: string | null): string {
  invariant(
    initialURL?.startsWith(IOS_PROOF_DEEP_LINK_PREFIX) === true,
    "The iOS networking proof requires its run-scoped cold-launch URL.",
  );
  const encodedOrigin = initialURL.slice(IOS_PROOF_DEEP_LINK_PREFIX.length);
  invariant(
    encodedOrigin.length > 0 &&
      encodedOrigin.length <= 512 &&
      !encodedOrigin.includes("&") &&
      !encodedOrigin.includes("#"),
    "The iOS networking proof launch capability was malformed.",
  );
  let decodedOrigin: string;
  try {
    decodedOrigin = decodeURIComponent(encodedOrigin);
  } catch {
    throw new Error(
      "The iOS networking proof launch capability was not valid percent encoding.",
    );
  }
  const origin = new URL(decodedOrigin);
  const port = Number(origin.port);
  invariant(
    origin.protocol === "http:" &&
      origin.username === "" &&
      origin.password === "" &&
      (IOS_LOCAL_HOST.test(origin.hostname) ||
        isPrivateIPv4Address(origin.hostname)) &&
      origin.port !== "" &&
      Number.isSafeInteger(port) &&
      port >= 1_024 &&
      port <= 65_535 &&
      IOS_RUN_PATH.test(origin.pathname) &&
      origin.search === "" &&
      origin.hash === "" &&
      decodedOrigin === `${origin.protocol}//${origin.host}${origin.pathname}`,
    "The iOS networking proof origin must be a tokenized local Mac HTTP endpoint.",
  );
  return decodedOrigin;
}

async function resolveDeviceServerOrigin(
  platform: "android" | "ios",
): Promise<string> {
  if (platform === "android") return ANDROID_DEVICE_SERVER_ORIGIN;
  const initialURL = await getReactNativePlatformServices().getInitialURL();
  return parseIOSNetworkingProofOrigin(initialURL);
}

function responseHeader(
  response: NetworkResponse,
  expectedName: string,
): string | undefined {
  const normalized = expectedName.toLowerCase();
  return Object.entries(response.headers).find(
    ([name]) => name.toLowerCase() === normalized,
  )?.[1];
}

function startedOperation(
  records: readonly CausalTelemetryRecord[],
  name: string,
  predicate: (
    record: Extract<
      CausalTelemetryRecord,
      { readonly type: "operation-started" }
    >,
  ) => boolean,
) {
  return records.find(
    (
      record,
    ): record is Extract<
      CausalTelemetryRecord,
      { readonly type: "operation-started" }
    > =>
      record.type === "operation-started" &&
      record.name === name &&
      predicate(record),
  );
}

async function waitForLifecycleEvent<Event>(
  events: ReadonlyMap<number, Event>,
  sequence: number,
  kind: "mount" | "frame",
): Promise<Event> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const event = events.get(sequence);
    if (event !== undefined) return event;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Networking commit ${String(sequence)} did not reach its ${kind} boundary.`,
  );
}

function jsonRecord(
  value: NetworkJSONValue,
): Readonly<Record<string, NetworkJSONValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The native JSON proof did not return an object.");
  }
  return value as Readonly<Record<string, NetworkJSONValue>>;
}

function ProofButton(props: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessible
      accessibilityLabel={props.label}
      accessibilityRole="button"
      onPress={props.onPress}
      style={{
        backgroundColor: "#0f766e",
        borderRadius: 8,
        marginTop: 12,
        padding: 12,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 16 }}>{props.label}</Text>
    </Pressable>
  );
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    const deviceServerOrigin = await resolveDeviceServerOrigin(
      binding.platform,
    );
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const mountEvents = new Map<number, HostCommitMountedEvent>();
    const frameEvents = new Map<number, HostCommitFrameEvent>();
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-network-${++operationSequence}`,
    });
    const service = createReactNativeNetworkService();
    invariant(
      service.platform === binding.platform,
      "The native network platform disagreed with the Fabric binding.",
    );
    let application: NativeApplication;
    let ownerSettlement: Promise<void> | undefined;

    const verifyCausalCommit = async (
      eventName:
        | "platform.network.response"
        | "platform.network.chunk"
        | "platform.network.complete",
      marker: string,
    ): Promise<void> => {
      await Promise.resolve();
      const commit = await application.root.flush();
      invariant(
        commit !== undefined && Number.isSafeInteger(commit.hostRevision),
        `${eventName} did not produce a native commit.`,
      );
      const mounted = await waitForLifecycleEvent(
        mountEvents,
        commit.sequence,
        "mount",
      );
      const frame = await waitForLifecycleEvent(
        frameEvents,
        commit.sequence,
        "frame",
      );
      invariant(
        mounted.hostRevision === commit.hostRevision &&
          frame.hostRevision === commit.hostRevision &&
          frame.frameStartedAt >= mounted.mountedAt,
        `${eventName} produced inconsistent native lifecycle evidence.`,
      );
      const commitStarted = startedOperation(
        records,
        "solid-native.commit",
        (record) => record.attributes["commit.sequence"] === commit.sequence,
      );
      const nativeEvent = startedOperation(
        records,
        "solid-native.event",
        (record) =>
          record.attributes["event.name"] === eventName &&
          commitStarted?.causes.includes(record.operationId) === true,
      );
      const computation = startedOperation(
        records,
        "solid-native.computation",
        (record) =>
          record.attributes["computation.name"] === OUTPUT_COMPUTATION_NAME &&
          commitStarted?.causes.includes(record.operationId) === true,
      );
      const mountStarted = startedOperation(
        records,
        "solid-native.mount",
        (record) =>
          record.attributes["commit.sequence"] === commit.sequence &&
          record.attributes["mount.host_revision"] === commit.hostRevision,
      );
      const frameStarted = startedOperation(
        records,
        "solid-native.frame",
        (record) =>
          record.attributes["commit.sequence"] === commit.sequence &&
          record.attributes["frame.host_revision"] === commit.hostRevision,
      );
      invariant(
        commitStarted !== undefined &&
          nativeEvent?.attributes["event.priority"] === "default" &&
          computation !== undefined &&
          mountStarted?.causes.length === 1 &&
          mountStarted.causes[0] === commitStarted.operationId &&
          frameStarted?.causes.length === 1 &&
          frameStarted.causes[0] === mountStarted.operationId,
        `${eventName} lost its native event, Solid computation, commit, mount, or frame cause.`,
      );
      console.log(marker, commit.sequence, commit.hostRevision);
    };

    application = startApplication(
      () => {
        const network = createNetworkController(service);
        const [status, setStatus] = createSignal("Networking proof untouched");
        let running = false;
        let disposalRequestStarted = false;
        let serverEvents: ServerEvent[] = [];
        let responseProof: Promise<void> | undefined;
        let chunkProof: Promise<void> | undefined;
        const stream = createServerEventStream(network, false, {
          onResponse(response) {
            invariant(
              response.status === 200 &&
                response.url === `${deviceServerOrigin}/events` &&
                responseHeader(response, "x-solid-native-proof") ===
                  "event-stream",
              "The native stream omitted its response metadata.",
            );
            setStatus(RESPONSE_TEXT);
            responseProof = verifyCausalCommit(
              "platform.network.response",
              "SOLID_NATIVE_NETWORKING_RESPONSE_CAUSALITY_SUCCEEDED",
            );
            void responseProof.catch(() => undefined);
          },
          onEvent(event) {
            serverEvents.push(event);
            if (serverEvents.length === 1) {
              setStatus(SSE_TEXT);
              chunkProof = verifyCausalCommit(
                "platform.network.chunk",
                "SOLID_NATIVE_NETWORKING_CHUNK_CAUSALITY_SUCCEEDED",
              );
              void chunkProof.catch(() => undefined);
            }
          },
          request: { maxEvents: 2 },
        });

        const executeProtocolProof = async (): Promise<void> => {
          serverEvents = [];
          responseProof = undefined;
          chunkProof = undefined;
          const streamResult = await stream.restart({
            url: `${deviceServerOrigin}/events`,
            headers: { Accept: "text/event-stream" },
            timeoutMilliseconds: PROOF_TIMEOUT_MS,
            maxResponseCharacters: 16_384,
          });
          invariant(
            streamResult !== undefined,
            "The Solid-owned SSE stream did not start.",
          );
          invariant(
            responseProof !== undefined && chunkProof !== undefined,
            "The physical SSE request omitted response or chunk causal work.",
          );
          await responseProof;
          await chunkProof;
          invariant(
            streamResult.eventCount === 2 &&
              streamResult.lastEventId === "native-2" &&
              streamResult.retryMilliseconds === 1_500 &&
              streamResult.chunkCount >= 1 &&
              streamResult.receivedCharacters > 0 &&
              serverEvents[0]?.type === "token" &&
              serverEvents[0]?.data === "hello" &&
              serverEvents[1]?.type === "message" &&
              serverEvents[1]?.data === "world",
            "The physical SSE stream lost framing, identifiers, retry state, or native chunks.",
          );
          console.log(
            "SOLID_NATIVE_NETWORKING_SSE_SUCCEEDED",
            streamResult.chunkCount,
            streamResult.receivedCharacters,
          );

          let jsonProof: Promise<void> | undefined;
          const document = requestJSON(
            network,
            {
              url: `${deviceServerOrigin}/json`,
              method: "POST",
              headers: {
                Accept: "application/vnd.solid-native+json",
                "Content-Type": "application/json",
                "X-Solid-Native-Proof": "network-header-secret-91ef",
              },
              body: '{"request":"network-body-secret-4b7a"}',
              timeoutMilliseconds: PROOF_TIMEOUT_MS,
              maxResponseCharacters: 4_096,
            },
            {
              onResponse(response) {
                invariant(
                  response.status === 201 &&
                    responseHeader(response, "content-type")?.startsWith(
                      "application/vnd.solid-native+json",
                    ) === true,
                  "The native JSON response lost its status or media type.",
                );
              },
              onResult(result) {
                const value = jsonRecord(result.value);
                invariant(
                  value.phase === "native" &&
                    value.count === 2 &&
                    Object.isFrozen(value),
                  "The native JSON response was not exact and deeply frozen.",
                );
                setStatus(JSON_TEXT);
                jsonProof = verifyCausalCommit(
                  "platform.network.complete",
                  "SOLID_NATIVE_NETWORKING_JSON_CAUSALITY_SUCCEEDED",
                );
                void jsonProof.catch(() => undefined);
              },
            },
          );
          const jsonResult = await document.result;
          invariant(
            jsonProof !== undefined,
            "The physical JSON request omitted completion causal work.",
          );
          await jsonProof;
          invariant(
            jsonRecord(jsonResult.value).count === 2 &&
              jsonResult.response.status === 201 &&
              jsonResult.chunkCount >= 1,
            "The native JSON request did not complete through its bounded document layer.",
          );
          console.log(
            "SOLID_NATIVE_NETWORKING_JSON_SUCCEEDED",
            jsonResult.chunkCount,
            jsonResult.receivedCharacters,
          );

          const failed = network.requestText({
            url: `${deviceServerOrigin}/failure`,
            timeoutMilliseconds: PROOF_TIMEOUT_MS,
          });
          let failure: unknown;
          try {
            await failed.result;
          } catch (error) {
            failure = error;
          }
          invariant(
            failure instanceof NetworkTransportError,
            "The native socket failure did not reject as NetworkTransportError.",
          );
          console.log("SOLID_NATIVE_NETWORKING_FAILURE_SUCCEEDED");

          let cancellation: NetworkTextRequestHandle | undefined;
          let cancellationChunk = false;
          cancellation = network.requestText(
            {
              url: `${deviceServerOrigin}/cancel`,
              timeoutMilliseconds: PROOF_TIMEOUT_MS,
            },
            {
              onChunk(chunk) {
                invariant(
                  chunk.sequence === 1 && chunk.text.includes("cancel-ready"),
                  "The cancellation request lost its first native chunk.",
                );
                cancellationChunk = true;
                cancellation?.cancel();
              },
            },
          );
          let cancellationError: unknown;
          try {
            await cancellation.result;
          } catch (error) {
            cancellationError = error;
          }
          invariant(
            cancellationChunk &&
              cancellationError instanceof NetworkRequestCancelledError,
            "The active native request did not settle as explicit cancellation.",
          );
          console.log("SOLID_NATIVE_NETWORKING_CANCELLATION_SUCCEEDED");

          const serialized = JSON.stringify(records);
          for (const privateValue of [
            deviceServerOrigin,
            "hello",
            "world",
            "network-header-secret-91ef",
            "network-body-secret-4b7a",
          ]) {
            invariant(
              !serialized.includes(privateValue),
              "Private networking content escaped into causal telemetry.",
            );
          }
          setStatus(COMPLETE_TEXT);
          const finalCommit = await application.root.flush();
          invariant(
            finalCommit !== undefined,
            "The final networking result did not mount.",
          );
          await waitForLifecycleEvent(
            frameEvents,
            finalCommit.sequence,
            "frame",
          );
          running = false;
          console.log("SOLID_NATIVE_NETWORKING_PROTOCOL_SUCCEEDED");
        };

        const startProtocolProof = (): void => {
          if (running || disposalRequestStarted) return;
          running = true;
          void executeProtocolProof().catch(reportFatal);
        };

        const startOwnerDisposalRequest = (): void => {
          if (running || disposalRequestStarted) return;
          disposalRequestStarted = true;
          const request = network.requestText(
            {
              url: `${deviceServerOrigin}/dispose`,
              timeoutMilliseconds: PROOF_TIMEOUT_MS,
            },
            {
              onChunk(chunk) {
                invariant(
                  chunk.sequence === 1 && chunk.text.includes("dispose-ready"),
                  "The owner-disposal request lost its first native chunk.",
                );
                setStatus(DISPOSAL_ACTIVE_TEXT);
                void application.root.flush().catch(reportFatal);
                console.log("SOLID_NATIVE_NETWORKING_DISPOSAL_ACTIVE");
              },
            },
          );
          ownerSettlement = request.result.then(
            () => {
              throw new Error(
                "The owner-disposal request completed instead of being cancelled.",
              );
            },
            (error: unknown) => {
              if (!(error instanceof NetworkOwnerDisposedError)) {
                const detail =
                  error instanceof Error
                    ? `${error.name}: ${error.message}`
                    : typeof error;
                throw new Error(
                  `Owner disposal did not reject pending native work with NetworkOwnerDisposedError; received ${detail}.`,
                );
              }
              console.log(
                "SOLID_NATIVE_NETWORKING_OWNER_CANCELLATION_SUCCEEDED",
              );
            },
          );
          void ownerSettlement.catch(() => undefined);
        };

        const disposeApplication = async (): Promise<void> => {
          invariant(
            ownerSettlement !== undefined,
            "The networking owner was disposed without an active request.",
          );
          await application.dispose();
          await ownerSettlement;
          invariant(
            !binding.getSurfaceInfo().ready,
            "The networking proof resolved disposal before its native surface stopped.",
          );
          console.log("SOLID_NATIVE_NETWORKING_TEARDOWN_SUCCEEDED");
        };

        return (
          <CausalOwner name="networking.root">
            <View
              style={{
                alignItems: "stretch",
                backgroundColor: "#f0fdfa",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 22 }}>
                {READY_TEXT}
              </Text>
              <CausalComputation name={OUTPUT_COMPUTATION_NAME}>
                <Text style={{ color: "#115e59", fontSize: 16 }}>{status}</Text>
              </CausalComputation>
              <ProofButton label={RUN_LABEL} onPress={startProtocolProof} />
              <ProofButton
                label={START_DISPOSAL_LABEL}
                onPress={startOwnerDisposalRequest}
              />
              <ProofButton
                label={DISPOSE_LABEL}
                onPress={() => {
                  void disposeApplication().catch(reportFatal);
                }}
              />
            </View>
          </CausalOwner>
        );
      },
      host,
      {
        surface: {
          name: "networking-e2e",
          initialProps: {
            style: { backgroundColor: "#f0fdfa", flex: 1 },
          },
        },
        autoCommit: false,
        requirements: {
          capabilities: ["commitMountEvents"],
          components: ["Pressable", "Text", "View"],
        },
        telemetry,
        onCommitError: reportFatal,
      },
    );
    host.subscribeLifecycle((event) => {
      if (event.type === "commit-mounted") {
        mountEvents.set(event.sequence, event);
      } else {
        frameEvents.set(event.sequence, event);
      }
    });
    const initial = await application.root.flush();
    invariant(
      initial?.sequence === 1,
      "The networking proof did not mount commit 1.",
    );
    await waitForLifecycleEvent(mountEvents, initial.sequence, "mount");
    await waitForLifecycleEvent(frameEvents, initial.sequence, "frame");
    console.log("SOLID_NATIVE_NETWORKING_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
