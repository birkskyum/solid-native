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
import {
  createReactNativeImageService,
  ImagePrefetchCancelledError,
} from "@solid-native/images/react-native";
import {
  createImageController,
  ImageOwnerDisposedError,
} from "@solid-native/images/solid";
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

const IMAGE_SERVER_ORIGIN = "http://127.0.0.1:38474";
const DIMENSIONS_URI = `${IMAGE_SERVER_ORIGIN}/dimensions.png`;
const PREFETCH_URI = `${IMAGE_SERVER_ORIGIN}/prefetch.png`;
const MISSING_URI = `${IMAGE_SERVER_ORIGIN}/missing.png`;
const CANCELLATION_URI = `${IMAGE_SERVER_ORIGIN}/cancel.png`;
const OWNER_DISPOSAL_URI = `${IMAGE_SERVER_ORIGIN}/dispose.png`;
const IMAGE_PROOF_HEADER = "private-image-header-37bd";
const READY_TEXT = "Solid Native images ready";
const RUN_LABEL = "Run native image cache proof";
const START_CANCELLATION_LABEL = "Start cancellable native image prefetch";
const CANCEL_LABEL = "Cancel native image prefetch";
const START_OWNER_DISPOSAL_LABEL = "Start owner-disposal image prefetch";
const DISPOSE_LABEL = "Dispose active Solid Native image owner";
const COMPLETE_TEXT = "Native image cache proof complete";
const CANCELLATION_ACTIVE_TEXT = "Cancellable image prefetch active";
const CANCELLED_TEXT = "Native image prefetch cancelled";
const OWNER_DISPOSAL_ACTIVE_TEXT = "Owner-disposal image prefetch active";
const OUTPUT_COMPUTATION_NAME = "platform.image.output";

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_IMAGES_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
        backgroundColor: "#a21caf",
        borderRadius: 8,
        marginTop: 8,
        padding: 10,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 15 }}>{props.label}</Text>
    </Pressable>
  );
}

async function run(): Promise<void> {
  try {
    const binding = getNativeHostBinding();
    await waitForNativeSurface({ binding, timeoutMs: 5_000 });
    invariant(
      binding.platform === "android",
      "The physical image cache proof currently requires Android.",
    );
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const service = createReactNativeImageService();
    invariant(
      service.platform === binding.platform,
      "The image service platform disagreed with the Fabric binding.",
    );
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-image-${++operationSequence}`,
    });
    let application: NativeApplication;
    let ownerSettlement: Promise<void> | undefined;

    const verifyCausalCommit = async (
      eventName:
        | "platform.image.dimensions"
        | "platform.image.prefetch"
        | "platform.image.cache-query",
      marker: string,
    ): Promise<void> => {
      await Promise.resolve();
      const commit = await application.root.flushMounted();
      invariant(
        commit !== undefined,
        `${eventName} did not produce a native commit.`,
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
      invariant(
        commitStarted?.attributes["commit.priority"] === "normal" &&
          nativeEvent?.attributes["event.priority"] === "default" &&
          computation !== undefined,
        `${eventName} lost its default-priority native event, Solid computation, or normal commit.`,
      );
      const serialized = JSON.stringify(records);
      invariant(
        !serialized.includes(IMAGE_SERVER_ORIGIN) &&
          !serialized.includes(IMAGE_PROOF_HEADER),
        "A private image URI or request header escaped into causal telemetry.",
      );
      console.log(marker, commit.sequence);
    };

    application = startApplication(
      () => {
        const images = createImageController(service);
        const [status, setStatus] = createSignal("Image proof untouched");
        let cacheProofRunning = false;
        let cancellationHandle: ReturnType<typeof service.prefetch> | undefined;
        let ownerPrefetchStarted = false;

        const publishStatus = async (
          value: string,
          marker: string,
        ): Promise<void> => {
          setStatus(value);
          const commit = await application.root.flushMounted();
          invariant(
            commit !== undefined,
            `${marker} did not produce a native commit.`,
          );
          console.log(marker, commit.sequence);
        };

        const executeCacheProof = async (): Promise<void> => {
          invariant(
            !cacheProofRunning,
            "The image cache proof was already running.",
          );
          cacheProofRunning = true;
          try {
            const cold = await images.queryCache([PREFETCH_URI, MISSING_URI]);
            invariant(
              cold.length === 2 &&
                cold[0]?.uri === PREFETCH_URI &&
                cold[0].location === "none" &&
                cold[1]?.uri === MISSING_URI &&
                cold[1].location === "none",
              "The native image cache was not cold before prefetch.",
            );
            setStatus("Native image cache cold");
            await verifyCausalCommit(
              "platform.image.cache-query",
              "SOLID_NATIVE_IMAGES_CACHE_COLD_CAUSALITY_SUCCEEDED",
            );

            const dimensions = await images.getDimensions({
              uri: DIMENSIONS_URI,
              headers: { "X-Solid-Native-Image-Proof": IMAGE_PROOF_HEADER },
            });
            invariant(
              dimensions.width === 1 && dimensions.height === 1,
              `The native image dimensions were ${dimensions.width}x${dimensions.height}, expected 1x1.`,
            );
            setStatus("Native image dimensions received");
            await verifyCausalCommit(
              "platform.image.dimensions",
              "SOLID_NATIVE_IMAGES_DIMENSIONS_CAUSALITY_SUCCEEDED",
            );

            await images.prefetch(PREFETCH_URI);
            setStatus("Native image prefetched");
            await verifyCausalCommit(
              "platform.image.prefetch",
              "SOLID_NATIVE_IMAGES_PREFETCH_CAUSALITY_SUCCEEDED",
            );

            const cached = await images.queryCache([
              PREFETCH_URI,
              MISSING_URI,
              PREFETCH_URI,
            ]);
            invariant(
              cached.length === 3 &&
                cached[0]?.uri === PREFETCH_URI &&
                cached[0].location !== "none" &&
                cached[1]?.uri === MISSING_URI &&
                cached[1].location === "none" &&
                cached[2]?.uri === PREFETCH_URI &&
                cached[2].location === cached[0].location,
              "The native image cache did not preserve its ordered hot/missing/hot result.",
            );
            setStatus(COMPLETE_TEXT);
            await verifyCausalCommit(
              "platform.image.cache-query",
              "SOLID_NATIVE_IMAGES_CACHE_HOT_CAUSALITY_SUCCEEDED",
            );
            console.log(
              "SOLID_NATIVE_IMAGES_CACHE_SUCCEEDED",
              cached[0].location,
            );
          } finally {
            cacheProofRunning = false;
          }
        };

        const startExplicitCancellation = (): void => {
          invariant(
            cancellationHandle === undefined,
            "A cancellable image prefetch is already active.",
          );
          const handle = service.prefetch(CANCELLATION_URI);
          cancellationHandle = handle;
          void handle.result
            .then(
              () => {
                throw new Error(
                  "The explicitly cancelled native image prefetch completed.",
                );
              },
              async (error: unknown) => {
                invariant(
                  error instanceof ImagePrefetchCancelledError,
                  "The explicit native image abort used the wrong error contract.",
                );
                cancellationHandle = undefined;
                await publishStatus(
                  CANCELLED_TEXT,
                  "SOLID_NATIVE_IMAGES_EXPLICIT_CANCELLATION_SUCCEEDED",
                );
              },
            )
            .catch(reportFatal);
          void publishStatus(
            CANCELLATION_ACTIVE_TEXT,
            "SOLID_NATIVE_IMAGES_CANCELLATION_ACTIVE",
          ).catch(reportFatal);
        };

        const startOwnerDisposal = (): void => {
          invariant(
            !ownerPrefetchStarted,
            "The owner-disposal image prefetch was already started.",
          );
          ownerPrefetchStarted = true;
          ownerSettlement = images.prefetch(OWNER_DISPOSAL_URI).then(
            () => {
              throw new Error(
                "The owner-disposed native image prefetch completed.",
              );
            },
            (error: unknown) => {
              invariant(
                error instanceof ImageOwnerDisposedError,
                "Owner disposal used the wrong image rejection contract.",
              );
              console.log("SOLID_NATIVE_IMAGES_OWNER_CANCELLATION_SUCCEEDED");
            },
          );
          void ownerSettlement.catch(() => undefined);
          void publishStatus(
            OWNER_DISPOSAL_ACTIVE_TEXT,
            "SOLID_NATIVE_IMAGES_OWNER_DISPOSAL_ACTIVE",
          ).catch(reportFatal);
        };

        return (
          <CausalOwner name="images.root">
            <View
              style={{
                alignItems: "stretch",
                backgroundColor: "#fdf4ff",
                flex: 1,
                justifyContent: "center",
                padding: 20,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 21 }}>
                {READY_TEXT}
              </Text>
              <CausalComputation name={OUTPUT_COMPUTATION_NAME}>
                <Text style={{ color: "#701a75", fontSize: 15 }}>{status}</Text>
              </CausalComputation>
              <ProofButton
                label={RUN_LABEL}
                onPress={() => void executeCacheProof().catch(reportFatal)}
              />
              <ProofButton
                label={START_CANCELLATION_LABEL}
                onPress={startExplicitCancellation}
              />
              <ProofButton
                label={CANCEL_LABEL}
                onPress={() => {
                  invariant(
                    cancellationHandle !== undefined,
                    "No cancellable native image prefetch is active.",
                  );
                  cancellationHandle.cancel();
                }}
              />
              <ProofButton
                label={START_OWNER_DISPOSAL_LABEL}
                onPress={startOwnerDisposal}
              />
              <ProofButton
                label={DISPOSE_LABEL}
                onPress={() => {
                  invariant(
                    ownerSettlement !== undefined,
                    "The owner-disposal image prefetch is not active.",
                  );
                  void application.dispose().then(async () => {
                    await ownerSettlement;
                    if (binding.getSurfaceInfo().ready) {
                      throw new Error(
                        "The image proof resolved disposal before its native surface stopped.",
                      );
                    }
                    console.log("SOLID_NATIVE_IMAGES_TEARDOWN_SUCCEEDED");
                  }, reportFatal);
                }}
              />
            </View>
          </CausalOwner>
        );
      },
      host,
      {
        surface: {
          name: "images-e2e",
          initialProps: {
            style: { backgroundColor: "#fdf4ff", flex: 1 },
          },
        },
        autoCommit: false,
        requirements: { components: ["Pressable", "Text", "View"] },
        telemetry,
        onCommitError: reportFatal,
      },
    );
    const initial = await application.root.flushMounted();
    if (initial?.sequence !== 1) {
      throw new Error("The image proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_IMAGES_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
