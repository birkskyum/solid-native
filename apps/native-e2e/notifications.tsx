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
import { createNotificationEvent } from "@solid-native/notifications/solid";
import {
  createCausalTelemetry,
  type CausalTelemetryRecord,
} from "@solid-native/observability";
import {
  createSignal,
  effect,
  type NativeApplication,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
  waitForNativeSurface,
} from "@solid-native/runtime";

import { createGeneratedNotifyKitNotificationService } from "./adapters/NotifeeApiModule";

const READY_TEXT = "Solid Native notifications ready";
const AUTHORIZE_LABEL = "Authorize local notifications";
const AUTHORIZED_TEXT = "Native notification permission authorized";
const DISPLAY_LABEL = "Display local native notification";
const CANCEL_LABEL = "Cancel local native notification";
const DISPOSE_LABEL = "Dispose Solid Native notification proof";
const PENDING_TEXT = "No notification delivered";
const DELIVERED_TEXT = "Native notification delivery observed";
const CANCELLED_TEXT = "Native notification cancelled";
const NOTIFICATION_ID = "solid-native-ios-notification-proof";
const NOTIFICATION_TITLE = "Solid Native notification proof";
const NOTIFICATION_BODY = "Delivered by the wrapper-free native adapter";
const NOTIFICATION_CHANNEL_ID = "solid-native-device-proof";
const NOTIFICATION_CHANNEL_NAME = "Solid Native device proofs";
const NOTIFICATION_OWNER_NAME = "notification.root";
const NOTIFICATION_COMPUTATION_NAME = "platform.notification.output";

const PERMITTED_EVENT_ATTRIBUTES = new Set([
  "event.bubbles",
  "event.coalescible",
  "event.name",
  "event.priority",
  "event.source",
  "surface.id",
]);
const PERMITTED_COMPUTATION_ATTRIBUTES = new Set([
  "computation.kind",
  "computation.name",
]);
const PERMITTED_OWNER_ATTRIBUTES = new Set(["owner.name"]);

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_NOTIFICATION_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
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

function hasOnlyAttributes(
  record: Extract<
    CausalTelemetryRecord,
    { readonly type: "operation-started" }
  >,
  permitted: ReadonlySet<string>,
): boolean {
  return Object.keys(record.attributes).every(
    (name) => permitted.has(name) || name.startsWith("resource."),
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
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
        backgroundColor: "#be123c",
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
    const host = createNativeFabricHost({
      binding,
      descriptors: CORE_COMPONENT_DESCRIPTORS,
    });
    const service = createGeneratedNotifyKitNotificationService({
      platform: binding.platform,
      androidSmallIcon: "solid_native_notification",
    });
    const records: CausalTelemetryRecord[] = [];
    let operationSequence = 0;
    const telemetry = createCausalTelemetry({
      sink: (record) => records.push(record),
      createOperationId: () => `physical-notification-${++operationSequence}`,
    });
    let resolveDelivery: (() => void) | undefined;
    const delivery = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    let application: NativeApplication;
    let authorizationStarted = false;
    let displayStarted = false;
    let deliveryVerified = false;

    const verifyDeliveryCommit = async (): Promise<void> => {
      if (deliveryVerified) return;
      deliveryVerified = true;
      await Promise.resolve();
      const commit = await application.root.flushMounted();
      if (commit === undefined) {
        throw new Error(
          "Native notification delivery did not produce a commit.",
        );
      }
      const operation = startedOperation(
        records,
        "solid-native.commit",
        (record) => record.attributes["commit.sequence"] === commit.sequence,
      );
      const event = startedOperation(
        records,
        "solid-native.event",
        (record) =>
          record.attributes["event.name"] ===
            "platform.notification.delivered" &&
          operation?.causes.includes(record.operationId) === true,
      );
      const computation = startedOperation(
        records,
        "solid-native.computation",
        (record) =>
          record.attributes["computation.name"] ===
            NOTIFICATION_COMPUTATION_NAME &&
          operation?.causes.includes(record.operationId) === true,
      );
      const owner = startedOperation(
        records,
        "solid-native.owner",
        (record) =>
          record.attributes["owner.name"] === NOTIFICATION_OWNER_NAME &&
          operation?.causes.includes(record.operationId) === true,
      );
      if (
        operation === undefined ||
        operation.attributes["commit.priority"] !== "normal" ||
        operation.causes.length !== 3 ||
        event === undefined ||
        event.attributes["event.priority"] !== "default" ||
        event.attributes["event.source"] !== "platform" ||
        computation === undefined ||
        owner === undefined ||
        !hasOnlyAttributes(event, PERMITTED_EVENT_ATTRIBUTES) ||
        !hasOnlyAttributes(computation, PERMITTED_COMPUTATION_ATTRIBUTES) ||
        !hasOnlyAttributes(owner, PERMITTED_OWNER_ATTRIBUTES)
      ) {
        throw new Error(
          `Notification delivery lost its exact private event, owner, and computation causes (causes=${String(operation?.causes.length ?? 0)}, event=${String(event !== undefined)}, owner=${String(owner !== undefined)}, computation=${String(computation !== undefined)}).`,
        );
      }
      const serialized = JSON.stringify(records);
      for (const privateValue of [
        NOTIFICATION_ID,
        NOTIFICATION_TITLE,
        NOTIFICATION_BODY,
        NOTIFICATION_CHANNEL_ID,
        NOTIFICATION_CHANNEL_NAME,
      ]) {
        if (serialized.includes(privateValue)) {
          throw new Error(
            "Private notification content escaped into causal telemetry.",
          );
        }
      }
      if (
        !(await service.getDisplayedNotificationIds()).includes(NOTIFICATION_ID)
      ) {
        throw new Error(
          "Notify Kit did not report the physically delivered notification.",
        );
      }
      console.log("SOLID_NATIVE_NOTIFICATION_DELIVERY_SUCCEEDED");
      console.log("SOLID_NATIVE_NOTIFICATION_CAUSALITY_SUCCEEDED");
    };

    const authorizeNotifications = async (
      updateStatus: (value: string) => void,
    ): Promise<void> => {
      if (authorizationStarted) return;
      authorizationStarted = true;
      const permission = await service.requestPermission();
      if (
        permission.authorization !== "authorized" &&
        permission.authorization !== "provisional"
      ) {
        throw new Error(
          `Notification permission was not granted: ${permission.authorization}.`,
        );
      }
      updateStatus(AUTHORIZED_TEXT);
      await application.root.flushMounted();
      console.log("SOLID_NATIVE_NOTIFICATION_PERMISSION_SUCCEEDED");
    };

    const displayNotification = async (): Promise<void> => {
      if (displayStarted) return;
      const permission = await service.getPermission();
      if (
        permission.authorization !== "authorized" &&
        permission.authorization !== "provisional"
      ) {
        throw new Error(
          "Notification permission must be authorized before display.",
        );
      }
      displayStarted = true;
      await service.cancel(NOTIFICATION_ID);
      const id = await service.display({
        id: NOTIFICATION_ID,
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY,
        channel: {
          id: NOTIFICATION_CHANNEL_ID,
          name: NOTIFICATION_CHANNEL_NAME,
          importance: "default",
        },
      });
      if (id !== NOTIFICATION_ID) {
        throw new Error("Notify Kit returned the wrong notification id.");
      }
      await withTimeout(
        delivery,
        10_000,
        "Notify Kit did not emit its foreground delivery event.",
      );
    };

    const cancelNotification = async (
      updateStatus: (value: string) => void,
    ): Promise<void> => {
      await service.cancel(NOTIFICATION_ID);
      if (
        (await service.getDisplayedNotificationIds()).includes(NOTIFICATION_ID)
      ) {
        throw new Error("Notify Kit retained the cancelled notification.");
      }
      updateStatus(CANCELLED_TEXT);
      await application.root.flushMounted();
      console.log("SOLID_NATIVE_NOTIFICATION_CANCEL_SUCCEEDED");
    };

    const disposeApplication = async (): Promise<void> => {
      try {
        await service.cancel(NOTIFICATION_ID);
        await application.dispose();
        if (binding.getSurfaceInfo().ready) {
          throw new Error(
            "The notification proof resolved disposal before its native surface stopped.",
          );
        }
        console.log("SOLID_NATIVE_NOTIFICATION_TEARDOWN_SUCCEEDED");
      } catch (error) {
        reportFatal(error);
      }
    };

    application = startApplication(
      () => {
        const [status, setStatus] = createSignal(PENDING_TEXT);
        const notificationEvent = createNotificationEvent(service, {
          onError: reportFatal,
        });
        effect(
          () => notificationEvent(),
          (event) => {
            if (
              event?.kind !== "delivered" ||
              event.notificationId !== NOTIFICATION_ID
            ) {
              return;
            }
            setStatus(DELIVERED_TEXT);
            resolveDelivery?.();
            void verifyDeliveryCommit().catch(reportFatal);
          },
        );
        return (
          <CausalOwner name={NOTIFICATION_OWNER_NAME}>
            <View
              style={{
                alignItems: "stretch",
                backgroundColor: "#fff1f2",
                flex: 1,
                justifyContent: "center",
                padding: 24,
              }}
            >
              <Text accessibilityRole="header" style={{ fontSize: 22 }}>
                {READY_TEXT}
              </Text>
              <CausalComputation name={NOTIFICATION_COMPUTATION_NAME}>
                <Text style={{ color: "#881337", fontSize: 16 }}>{status}</Text>
              </CausalComputation>
              <ProofButton
                label={AUTHORIZE_LABEL}
                onPress={() => {
                  void authorizeNotifications(setStatus).catch(reportFatal);
                }}
              />
              <ProofButton
                label={DISPLAY_LABEL}
                onPress={() => {
                  void displayNotification().catch(reportFatal);
                }}
              />
              <ProofButton
                label={CANCEL_LABEL}
                onPress={() => {
                  void cancelNotification(setStatus).catch(reportFatal);
                }}
              />
              <ProofButton
                label={DISPOSE_LABEL}
                onPress={() => {
                  void disposeApplication();
                }}
              />
            </View>
          </CausalOwner>
        );
      },
      host,
      {
        surface: {
          name: "notification-e2e",
          initialProps: {
            style: { backgroundColor: "#fff1f2", flex: 1 },
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
      throw new Error("The notification proof did not mount exactly once.");
    }
    console.log("SOLID_NATIVE_NOTIFICATION_READY");
  } catch (error) {
    reportFatal(error);
  }
}

void run();
