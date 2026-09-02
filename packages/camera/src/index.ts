export const CAMERA_MAX_DEVICE_COUNT = 128;
export const CAMERA_MAX_IDENTIFIER_LENGTH = 512;
export const CAMERA_MAX_LABEL_LENGTH = 1_024;
export const CAMERA_MAX_EVENT_REASON_LENGTH = 2_048;
export const CAMERA_MAX_FILE_PATH_LENGTH = 4_096;

export type CameraAuthorization =
  "not-determined" | "denied" | "authorized" | "restricted";

export type CameraTargetPosition = "front" | "back" | "external";
export type CameraPosition = CameraTargetPosition | "unspecified";

export interface CameraPermission {
  readonly authorization: CameraAuthorization;
}

export interface CameraDevice {
  readonly id: string;
  readonly name: string;
  readonly position: CameraPosition;
  readonly type: string;
}

export type CameraSessionEventKind =
  "started" | "stopped" | "interrupted" | "resumed" | "error";

export interface CameraSessionEvent {
  readonly kind: CameraSessionEventKind;
  readonly reason?: string;
}

export type CameraFlashMode = "off" | "on" | "auto";
export type CameraPhotoOrientation = "up" | "right" | "down" | "left";
export type CameraPhotoContainerFormat =
  "jpeg" | "heic" | "dng" | "tiff" | "dcm" | "unknown";

export interface CameraPhotoCaptureOptions {
  readonly flashMode?: CameraFlashMode;
  readonly enableShutterSound?: boolean;
}

export interface CameraPhoto {
  /** Temporary filesystem path, without a `file://` prefix. */
  readonly filePath: string;
  readonly width: number;
  readonly height: number;
  readonly orientation: CameraPhotoOrientation;
  readonly containerFormat: CameraPhotoContainerFormat;
  /** Native host-clock timestamp in seconds. */
  readonly timestamp: number;
  readonly isMirrored: boolean;
}

export interface CameraSubscriptionOptions {
  readonly onError?: (error: unknown) => unknown;
}

export interface CameraSubscription {
  remove(): void;
}

export interface CameraSession {
  readonly device: CameraDevice;
  readonly stopped: boolean;
  capturePhoto(options?: CameraPhotoCaptureOptions): Promise<CameraPhoto>;
  subscribe(
    listener: (event: CameraSessionEvent) => unknown,
    options?: CameraSubscriptionOptions,
  ): CameraSubscription;
  stop(): Promise<void>;
}

export interface CameraService {
  getPermission(): CameraPermission;
  requestPermission(): Promise<CameraPermission>;
  listDevices(): Promise<readonly CameraDevice[]>;
  open(position: CameraTargetPosition): Promise<CameraSession>;
}

export interface CameraAdapterSession {
  readonly device: unknown;
  capturePhoto(options: CameraPhotoCaptureOptions): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): unknown;
  stop(): Promise<unknown>;
}

const ADAPTER_SESSION_BY_CAMERA_SESSION = new WeakMap<
  CameraSession,
  CameraAdapterSession
>();

/** @internal Adapter-specific packages use this without exposing it on CameraSession. */
export function cameraAdapterSessionFor(
  session: CameraSession,
): CameraAdapterSession | undefined {
  return ADAPTER_SESSION_BY_CAMERA_SESSION.get(session);
}

export interface CameraAdapter {
  getPermission(): unknown;
  requestPermission(): Promise<unknown>;
  listDevices(): Promise<unknown>;
  open(position: CameraTargetPosition): Promise<unknown>;
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedString(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must be a 1-${maximumLength} character string without null bytes.`,
    );
  }
  return value;
}

function permission(value: unknown): CameraPermission {
  const record = plainRecord(value, "Camera permission");
  if (
    record.authorization !== "not-determined" &&
    record.authorization !== "denied" &&
    record.authorization !== "authorized" &&
    record.authorization !== "restricted"
  ) {
    throw new TypeError("Camera permission authorization status is invalid.");
  }
  return Object.freeze({ authorization: record.authorization });
}

function targetPosition(value: unknown): CameraTargetPosition {
  if (value !== "front" && value !== "back" && value !== "external") {
    throw new TypeError("Camera target position is invalid.");
  }
  return value;
}

function position(value: unknown): CameraPosition {
  if (
    value !== "front" &&
    value !== "back" &&
    value !== "external" &&
    value !== "unspecified"
  ) {
    throw new TypeError("Camera device position is invalid.");
  }
  return value;
}

function device(value: unknown, path = "Camera device"): CameraDevice {
  const record = plainRecord(value, path);
  return Object.freeze({
    id: boundedString(record.id, `${path} id`, CAMERA_MAX_IDENTIFIER_LENGTH),
    name: boundedString(record.name, `${path} name`, CAMERA_MAX_LABEL_LENGTH),
    position: position(record.position),
    type: boundedString(
      record.type,
      `${path} type`,
      CAMERA_MAX_IDENTIFIER_LENGTH,
    ),
  });
}

function sessionEvent(value: unknown): CameraSessionEvent {
  const record = plainRecord(value, "Camera session event");
  if (
    record.kind !== "started" &&
    record.kind !== "stopped" &&
    record.kind !== "interrupted" &&
    record.kind !== "resumed" &&
    record.kind !== "error"
  ) {
    throw new TypeError("Camera session event kind is invalid.");
  }
  return Object.freeze({
    kind: record.kind,
    ...(record.reason === undefined
      ? {}
      : {
          reason: boundedString(
            record.reason,
            "Camera session event reason",
            CAMERA_MAX_EVENT_REASON_LENGTH,
          ),
        }),
  });
}

function photoCaptureOptions(
  value: CameraPhotoCaptureOptions,
): Readonly<Required<CameraPhotoCaptureOptions>> {
  const record = plainRecord(value, "Camera photo capture options");
  const flashMode = record.flashMode ?? "off";
  if (flashMode !== "off" && flashMode !== "on" && flashMode !== "auto") {
    throw new TypeError("Camera photo flash mode is invalid.");
  }
  const enableShutterSound = record.enableShutterSound ?? true;
  if (typeof enableShutterSound !== "boolean") {
    throw new TypeError(
      "Camera photo shutter-sound preference must be a boolean.",
    );
  }
  return Object.freeze({ flashMode, enableShutterSound });
}

function positiveDimension(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return value as number;
}

function photo(value: unknown): CameraPhoto {
  const record = plainRecord(value, "Captured camera photo");
  if (
    record.orientation !== "up" &&
    record.orientation !== "right" &&
    record.orientation !== "down" &&
    record.orientation !== "left"
  ) {
    throw new TypeError("Captured camera photo orientation is invalid.");
  }
  if (
    record.containerFormat !== "jpeg" &&
    record.containerFormat !== "heic" &&
    record.containerFormat !== "dng" &&
    record.containerFormat !== "tiff" &&
    record.containerFormat !== "dcm" &&
    record.containerFormat !== "unknown"
  ) {
    throw new TypeError("Captured camera photo container format is invalid.");
  }
  if (
    typeof record.timestamp !== "number" ||
    !Number.isFinite(record.timestamp) ||
    record.timestamp < 0
  ) {
    throw new TypeError(
      "Captured camera photo timestamp must be a finite non-negative number.",
    );
  }
  if (typeof record.isMirrored !== "boolean") {
    throw new TypeError(
      "Captured camera photo mirrored state must be a boolean.",
    );
  }
  return Object.freeze({
    filePath: boundedString(
      record.filePath,
      "Captured camera photo file path",
      CAMERA_MAX_FILE_PATH_LENGTH,
    ),
    width: positiveDimension(record.width, "Captured camera photo width"),
    height: positiveDimension(record.height, "Captured camera photo height"),
    orientation: record.orientation,
    containerFormat: record.containerFormat,
    timestamp: record.timestamp,
    isMirrored: record.isMirrored,
  });
}

function adapterMethod(
  adapter: CameraAdapter,
  name: keyof CameraAdapter,
): void {
  if (typeof adapter[name] !== "function") {
    throw new TypeError(`Camera adapter ${name} must be a function.`);
  }
}

function reportSubscriptionError(
  error: unknown,
  options: CameraSubscriptionOptions,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // A diagnostic callback cannot escape a native event boundary.
  }
}

function cameraSession(
  value: unknown,
  requestedPosition: CameraTargetPosition,
): CameraSession {
  const adapterSession = plainRecord(
    value,
    "Camera adapter session",
  ) as unknown as CameraAdapterSession;
  if (typeof adapterSession.subscribe !== "function") {
    throw new TypeError("Camera adapter session subscribe must be a function.");
  }
  if (typeof adapterSession.capturePhoto !== "function") {
    throw new TypeError(
      "Camera adapter session capturePhoto must be a function.",
    );
  }
  if (typeof adapterSession.stop !== "function") {
    throw new TypeError("Camera adapter session stop must be a function.");
  }
  const normalizedDevice = device(adapterSession.device);
  if (normalizedDevice.position !== requestedPosition) {
    throw new Error("The camera adapter opened a different device position.");
  }
  let stopped = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const subscriptions = new Set<() => void>();
  const session: CameraSession = {
    device: normalizedDevice,
    get stopped() {
      return stopped;
    },
    async capturePhoto(options: CameraPhotoCaptureOptions = {}) {
      if (stopping || stopped) {
        throw new Error(
          "Cannot capture a photo from a stopped camera session.",
        );
      }
      const normalizedOptions = photoCaptureOptions(options);
      return photo(await adapterSession.capturePhoto(normalizedOptions));
    },
    subscribe(
      listener: (event: CameraSessionEvent) => unknown,
      options: CameraSubscriptionOptions = {},
    ) {
      if (typeof listener !== "function") {
        throw new TypeError("Camera session listener must be a function.");
      }
      if (stopping || stopped) {
        throw new Error("Cannot subscribe to a stopped camera session.");
      }
      let active = true;
      let startedDelivered = false;
      const deliver = (value: unknown) => {
        if (!active) return;
        try {
          const event = sessionEvent(value);
          if (event.kind === "started") {
            if (startedDelivered) return;
            startedDelivered = true;
          }
          const result = listener(event);
          void Promise.resolve(result).catch((error: unknown) => {
            reportSubscriptionError(error, options);
          });
        } catch (error) {
          reportSubscriptionError(error, options);
        }
      };
      const remove = adapterSession.subscribe(deliver);
      if (typeof remove !== "function") {
        throw new TypeError(
          "Camera adapter session subscribe must return a cleanup function.",
        );
      }
      const cleanup = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(cleanup);
        remove();
      };
      subscriptions.add(cleanup);
      // Opening a public session is the readiness boundary. Some native
      // backends emit their started event while open() is still awaiting that
      // readiness, before a public subscriber can exist. Replay it on the next
      // event-loop turn and deduplicate a synchronous or late adapter callback.
      // A separate turn also keeps subscription setup out of the first native
      // rendering transaction that consumes the session.
      const timers = globalThis as typeof globalThis & {
        setTimeout(callback: () => void, milliseconds: number): unknown;
      };
      timers.setTimeout(() => deliver({ kind: "started" }), 0);
      return Object.freeze({ remove: cleanup });
    },
    stop() {
      if (stopPromise === undefined) {
        stopping = true;
        stopPromise = Promise.resolve()
          .then(() => adapterSession.stop())
          .then(() => undefined)
          .finally(() => {
            stopped = true;
            for (const cleanup of [...subscriptions]) cleanup();
          });
      }
      return stopPromise;
    },
  };
  ADAPTER_SESSION_BY_CAMERA_SESSION.set(session, adapterSession);
  return Object.freeze(session);
}

/**
 * Narrows a camera backend to bounded, portable permission, device, session,
 * capture, and lifecycle values. Native failures remain rejected promises.
 */
export function createCameraService(adapter: CameraAdapter): CameraService {
  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError("Camera adapter must be an object.");
  }
  adapterMethod(adapter, "getPermission");
  adapterMethod(adapter, "requestPermission");
  adapterMethod(adapter, "listDevices");
  adapterMethod(adapter, "open");

  return Object.freeze({
    getPermission() {
      return permission(adapter.getPermission());
    },
    async requestPermission() {
      return permission(await adapter.requestPermission());
    },
    async listDevices() {
      const value = await adapter.listDevices();
      if (!Array.isArray(value)) {
        throw new TypeError(
          "The camera adapter returned a non-array device list.",
        );
      }
      if (value.length > CAMERA_MAX_DEVICE_COUNT) {
        throw new RangeError(
          `Camera devices cannot exceed ${CAMERA_MAX_DEVICE_COUNT} entries.`,
        );
      }
      const devices = value.map((entry, index) =>
        device(entry, `Camera device ${String(index)}`),
      );
      if (new Set(devices.map((entry) => entry.id)).size !== devices.length) {
        throw new TypeError("Camera device ids must be unique.");
      }
      return Object.freeze(devices);
    },
    async open(requestedPosition: CameraTargetPosition) {
      const normalizedPosition = targetPosition(requestedPosition);
      if (permission(adapter.getPermission()).authorization !== "authorized") {
        throw new Error("Camera permission must be authorized before opening.");
      }
      const adapterSession = await adapter.open(normalizedPosition);
      try {
        return cameraSession(adapterSession, normalizedPosition);
      } catch (error) {
        if (
          typeof adapterSession === "object" &&
          adapterSession !== null &&
          "stop" in adapterSession &&
          typeof adapterSession.stop === "function"
        ) {
          try {
            await adapterSession.stop();
          } catch {
            // Preserve the portable validation failure while best-effort
            // releasing a malformed native session.
          }
        }
        throw error;
      }
    },
  });
}
