import { createCausalPlatformEventHandler } from "@solid-native/core";
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

import {
  type CameraDevice,
  type CameraService,
  type CameraSession,
  type CameraSessionEvent,
  type CameraSessionEventKind,
  type CameraSubscription,
  type CameraSubscriptionOptions,
  type CameraTargetPosition,
} from "./index.js";

export interface CameraSessionEventAccessorOptions extends CameraSubscriptionOptions {
  readonly initialValue?: CameraSessionEvent;
}

export type CameraSessionEventSource =
  CameraSession | Accessor<CameraSession | undefined>;

const CAMERA_SESSION_EVENT_NAMES = Object.freeze({
  started: "platform.camera.session.started",
  stopped: "platform.camera.session.stopped",
  interrupted: "platform.camera.session.interrupted",
  resumed: "platform.camera.session.resumed",
  error: "platform.camera.session.error",
} satisfies Record<CameraSessionEventKind, string>);

function reportAccessorError(
  error: unknown,
  options: CameraSessionEventAccessorOptions,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostics cannot break subscription handoff or owner disposal.
  }
}

/**
 * Projects validated native camera-session events into one fine-grained Solid
 * accessor and binds subscription replacement to the current owner.
 */
export function createCameraSessionEvent(
  source: CameraSessionEventSource,
  options: CameraSessionEventAccessorOptions = {},
): Accessor<CameraSessionEvent | undefined> {
  const [event, setEvent] = createSignal<CameraSessionEvent | undefined>(
    options.initialValue,
  );
  const handlers = Object.freeze({
    started: createCausalPlatformEventHandler(
      CAMERA_SESSION_EVENT_NAMES.started,
      setEvent,
    ),
    stopped: createCausalPlatformEventHandler(
      CAMERA_SESSION_EVENT_NAMES.stopped,
      setEvent,
    ),
    interrupted: createCausalPlatformEventHandler(
      CAMERA_SESSION_EVENT_NAMES.interrupted,
      setEvent,
    ),
    resumed: createCausalPlatformEventHandler(
      CAMERA_SESSION_EVENT_NAMES.resumed,
      setEvent,
    ),
    error: createCausalPlatformEventHandler(
      CAMERA_SESSION_EVENT_NAMES.error,
      setEvent,
    ),
  } satisfies Record<
    CameraSessionEventKind,
    (nextEvent: CameraSessionEvent) => unknown
  >);

  let removeSubscription: (() => void) | undefined;
  const removeCurrentSubscription = (): void => {
    const remove = removeSubscription;
    removeSubscription = undefined;
    if (remove === undefined) return;
    try {
      remove();
    } catch (error) {
      reportAccessorError(error, options);
    }
  };
  createEffect(
    () => (typeof source === "function" ? source() : source),
    (session) => {
      removeCurrentSubscription();
      if (session === undefined) return;
      try {
        const subscription = session.subscribe(
          (nextEvent) => handlers[nextEvent.kind](nextEvent),
          options,
        );
        removeSubscription = () => subscription.remove();
      } catch (error) {
        reportAccessorError(error, options);
      }
    },
  );
  onCleanup(removeCurrentSubscription);
  return event;
}

export type OwnedCameraSessionState =
  "starting" | "running" | "stopping" | "stopped" | "failed";

export interface OwnedCameraSessionOptions {
  readonly position: CameraTargetPosition;
  readonly onError?: (error: unknown) => unknown;
}

export interface OwnedCameraSession {
  readonly state: Accessor<OwnedCameraSessionState>;
  readonly device: Accessor<CameraDevice | undefined>;
  readonly ready: Promise<CameraSession>;
  stop(): Promise<void>;
}

function reportError(error: unknown, options: OwnedCameraSessionOptions): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Owner cleanup and native event delivery cannot be broken by diagnostics.
  }
}

/**
 * Opens an imperative camera session immediately and binds its native
 * listeners and asynchronous stop boundary to the current Solid owner.
 */
export function createOwnedCameraSession(
  service: CameraService,
  options: OwnedCameraSessionOptions,
): OwnedCameraSession {
  const [state, setState] = createSignal<OwnedCameraSessionState>("starting");
  const [device, setDevice] = createSignal<CameraDevice>();
  let ownerActive = true;
  let openingFailed = false;
  let subscription: CameraSubscription | undefined;
  let stopPromise: Promise<void> | undefined;

  const ready = service.open(options.position).then(async (session) => {
    setDevice(session.device);
    subscription = session.subscribe(
      (event) => {
        if (event.kind === "stopped") setState("stopped");
        if (event.kind === "error") {
          setState("failed");
          reportError(
            new Error(event.reason ?? "Native camera session failed."),
            options,
          );
        }
      },
      { onError: (error) => reportError(error, options) },
    );
    if (!ownerActive) {
      setState("stopping");
      await session.stop();
      setState("stopped");
    } else {
      setState("running");
    }
    return session;
  });
  void ready.catch((error: unknown) => {
    openingFailed = true;
    if (ownerActive) setState("failed");
    reportError(error, options);
  });

  const stop = (): Promise<void> => {
    if (stopPromise !== undefined) return stopPromise;
    ownerActive = false;
    if (state() !== "stopped" && state() !== "failed") {
      setState("stopping");
    }
    stopPromise = ready
      .then((session) => session.stop())
      .then(() => {
        subscription?.remove();
        setState("stopped");
      })
      .catch((error: unknown) => {
        setState("failed");
        if (!openingFailed) reportError(error, options);
        throw error;
      });
    return stopPromise;
  };

  onCleanup(() => {
    void stop().catch(() => undefined);
  });

  return Object.freeze({ state, device, ready, stop });
}
