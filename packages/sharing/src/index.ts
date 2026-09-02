export const SHARE_MAX_MESSAGE_LENGTH = 65_536;
export const SHARE_MAX_URL_LENGTH = 8_192;
export const SHARE_MAX_SUBJECT_LENGTH = 512;
export const SHARE_MAX_ACTIVITY_TYPE_LENGTH = 512;

export type SharePlatform = "android" | "ios";

export interface ShareRequest {
  /** Plain text presented to the receiving application. */
  readonly message?: string;
  /** Absolute URL presented separately on iOS and appended to text on Android. */
  readonly url?: string;
  /** Email subject on iOS and Intent subject on Android. */
  readonly subject?: string;
}

export interface NormalizedShareRequest {
  readonly message?: string;
  readonly url?: string;
  readonly subject?: string;
}

/**
 * Android resolves after launching its chooser, not after the user shares.
 * iOS reports whether an activity completed or the sheet was dismissed.
 */
export type ShareResult =
  | {
      readonly action: "presented";
    }
  | {
      readonly action: "completed";
      readonly activityType?: string;
    }
  | {
      readonly action: "dismissed";
    };

export interface ShareAdapter {
  readonly platform: SharePlatform;
  showShareSheet(request: NormalizedShareRequest): Promise<unknown>;
}

export interface ShareService {
  readonly platform: SharePlatform;
  share(request: ShareRequest): Promise<ShareResult>;
}

export class SharePresentationInProgressError extends Error {
  constructor() {
    super("Another system share sheet is still in progress.");
    this.name = "SharePresentationInProgressError";
  }
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object.`);
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

function optionalString(
  value: unknown,
  path: string,
  maximumLength: number,
): string | undefined {
  return value === undefined
    ? undefined
    : boundedString(value, path, maximumLength);
}

function absoluteURL(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const url = boundedString(value, "Share URL", SHARE_MAX_URL_LENGTH);
  if (
    !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(url) ||
    /[\u0000-\u001f\u007f]/u.test(url)
  ) {
    throw new TypeError(
      "Share URL must be an absolute URI without ASCII control characters.",
    );
  }
  return url;
}

function normalizeShareRequest(value: ShareRequest): NormalizedShareRequest {
  const request = plainRecord(value, "Share request");
  const message = optionalString(
    request.message,
    "Share message",
    SHARE_MAX_MESSAGE_LENGTH,
  );
  const url = absoluteURL(request.url);
  const subject = optionalString(
    request.subject,
    "Share subject",
    SHARE_MAX_SUBJECT_LENGTH,
  );
  if (message === undefined && url === undefined) {
    throw new TypeError("A share request requires a non-empty message or URL.");
  }
  return Object.freeze({
    ...(message === undefined ? {} : { message }),
    ...(url === undefined ? {} : { url }),
    ...(subject === undefined ? {} : { subject }),
  });
}

function shareResult(value: unknown, platform: SharePlatform): ShareResult {
  const result = plainRecord(value, "Native share result");
  if (platform === "android") {
    if (result.action !== "presented" || result.activityType !== undefined) {
      throw new TypeError(
        "An Android native share result must contain only action presented.",
      );
    }
    return Object.freeze({ action: "presented" });
  }
  if (result.action === "dismissed") {
    if (result.activityType !== undefined) {
      throw new TypeError(
        "A dismissed native share result must not contain an activity type.",
      );
    }
    return Object.freeze({ action: "dismissed" });
  }
  if (result.action !== "completed") {
    throw new TypeError(
      "An iOS native share result action must be completed or dismissed.",
    );
  }
  const activityType = optionalString(
    result.activityType,
    "Native share activity type",
    SHARE_MAX_ACTIVITY_TYPE_LENGTH,
  );
  return Object.freeze({
    action: "completed",
    ...(activityType === undefined ? {} : { activityType }),
  });
}

/** Validates application input and untrusted native settlement payloads. */
export function createShareService(adapter: ShareAdapter): ShareService {
  const candidate = plainRecord(adapter, "Share adapter");
  if (candidate.platform !== "android" && candidate.platform !== "ios") {
    throw new TypeError("Share adapter platform must be android or ios.");
  }
  if (typeof candidate.showShareSheet !== "function") {
    throw new TypeError("Share adapter must provide showShareSheet().");
  }
  const platform = candidate.platform;
  let presentationActive = false;
  return Object.freeze({
    platform,
    async share(request: ShareRequest): Promise<ShareResult> {
      const normalized = normalizeShareRequest(request);
      if (presentationActive) {
        throw new SharePresentationInProgressError();
      }
      presentationActive = true;
      try {
        return shareResult(await adapter.showShareSheet(normalized), platform);
      } finally {
        presentationActive = false;
      }
    },
  });
}
