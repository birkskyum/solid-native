export const ACCESSIBILITY_MAX_ANNOUNCEMENT_LENGTH = 4_096;
export const ACCESSIBILITY_MAX_TIMEOUT_MILLISECONDS = 2_147_483_647;

export type AccessibilityPlatform = "android" | "ios";
export type AccessibilityAnnouncementPriority = "low" | "default" | "high";
export type AccessibilityPreferenceKey =
  | "screenReaderEnabled"
  | "reduceMotionEnabled"
  | "invertColorsEnabled"
  | "grayscaleEnabled"
  | "highTextContrastEnabled"
  | "accessibilityServiceEnabled"
  | "boldTextEnabled"
  | "darkerSystemColorsEnabled"
  | "reduceTransparencyEnabled"
  | "prefersCrossFadeTransitions";

export interface AccessibilityPreferencesCommon {
  readonly platform: AccessibilityPlatform;
  readonly screenReaderEnabled: boolean;
  readonly reduceMotionEnabled: boolean;
  readonly invertColorsEnabled: boolean;
  readonly grayscaleEnabled: boolean;
}

export interface AndroidAccessibilityPreferences extends AccessibilityPreferencesCommon {
  readonly platform: "android";
  readonly highTextContrastEnabled: boolean;
  readonly accessibilityServiceEnabled: boolean;
}

export interface IOSAccessibilityPreferences extends AccessibilityPreferencesCommon {
  readonly platform: "ios";
  readonly boldTextEnabled: boolean;
  readonly darkerSystemColorsEnabled: boolean;
  readonly reduceTransparencyEnabled: boolean;
  readonly prefersCrossFadeTransitions: boolean;
}

export type AccessibilityPreferences =
  AndroidAccessibilityPreferences | IOSAccessibilityPreferences;

export interface AccessibilityPreferenceChange {
  readonly preference: AccessibilityPreferenceKey;
  readonly enabled: boolean;
}

export interface AccessibilityAnnouncement {
  readonly message: string;
  /** iOS-only speech queue behavior. */
  readonly queue?: boolean;
  /** iOS-only announcement priority. */
  readonly priority?: AccessibilityAnnouncementPriority;
}

export interface NormalizedAccessibilityAnnouncement {
  readonly message: string;
  readonly queue: boolean;
  readonly priority: AccessibilityAnnouncementPriority;
}

export interface AccessibilitySubscription {
  remove(): void;
}

export interface AccessibilitySubscriptionOptions {
  readonly onError?: (error: unknown) => unknown;
}

export interface AccessibilityAdapter {
  readonly platform: AccessibilityPlatform;
  getPreferences(): Promise<unknown>;
  subscribe(listener: (change: unknown) => void): unknown;
  announce(request: NormalizedAccessibilityAnnouncement): void;
  getRecommendedTimeoutMillis(originalTimeout: number): Promise<unknown>;
}

export interface AccessibilityService {
  readonly platform: AccessibilityPlatform;
  getPreferences(): Promise<AccessibilityPreferences>;
  subscribe(
    listener: (change: AccessibilityPreferenceChange) => unknown,
    options?: AccessibilitySubscriptionOptions,
  ): AccessibilitySubscription;
  announce(request: string | AccessibilityAnnouncement): void;
  getRecommendedTimeoutMillis(originalTimeout: number): Promise<number>;
}

const COMMON_PREFERENCES = Object.freeze([
  "screenReaderEnabled",
  "reduceMotionEnabled",
  "invertColorsEnabled",
  "grayscaleEnabled",
] as const);
const ANDROID_PREFERENCES = Object.freeze([
  "highTextContrastEnabled",
  "accessibilityServiceEnabled",
] as const);
const IOS_PREFERENCES = Object.freeze([
  "boldTextEnabled",
  "darkerSystemColorsEnabled",
  "reduceTransparencyEnabled",
  "prefersCrossFadeTransitions",
] as const);

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function booleanField(
  value: Readonly<Record<string, unknown>>,
  key: AccessibilityPreferenceKey,
  path: string,
): boolean {
  if (typeof value[key] !== "boolean") {
    throw new TypeError(`${path}.${key} must be a boolean.`);
  }
  return value[key];
}

function accessibilityPreferences(
  value: unknown,
  platform: AccessibilityPlatform,
): AccessibilityPreferences {
  const candidate = record(value, "Native accessibility preferences");
  if (candidate.platform !== platform) {
    throw new TypeError(
      "Native accessibility preferences must match the service platform.",
    );
  }
  const common = Object.fromEntries(
    COMMON_PREFERENCES.map((key) => [
      key,
      booleanField(candidate, key, "Native accessibility preferences"),
    ]),
  ) as Pick<
    AccessibilityPreferencesCommon,
    (typeof COMMON_PREFERENCES)[number]
  >;
  if (platform === "android") {
    return Object.freeze({
      platform,
      ...common,
      highTextContrastEnabled: booleanField(
        candidate,
        "highTextContrastEnabled",
        "Native accessibility preferences",
      ),
      accessibilityServiceEnabled: booleanField(
        candidate,
        "accessibilityServiceEnabled",
        "Native accessibility preferences",
      ),
    });
  }
  return Object.freeze({
    platform,
    ...common,
    boldTextEnabled: booleanField(
      candidate,
      "boldTextEnabled",
      "Native accessibility preferences",
    ),
    darkerSystemColorsEnabled: booleanField(
      candidate,
      "darkerSystemColorsEnabled",
      "Native accessibility preferences",
    ),
    reduceTransparencyEnabled: booleanField(
      candidate,
      "reduceTransparencyEnabled",
      "Native accessibility preferences",
    ),
    prefersCrossFadeTransitions: booleanField(
      candidate,
      "prefersCrossFadeTransitions",
      "Native accessibility preferences",
    ),
  });
}

function allowedPreferenceKeys(
  platform: AccessibilityPlatform,
): ReadonlySet<string> {
  return new Set([
    ...COMMON_PREFERENCES,
    ...(platform === "android" ? ANDROID_PREFERENCES : IOS_PREFERENCES),
  ]);
}

function accessibilityChange(
  value: unknown,
  allowed: ReadonlySet<string>,
): AccessibilityPreferenceChange {
  const candidate = record(value, "Native accessibility change");
  if (
    typeof candidate.preference !== "string" ||
    !allowed.has(candidate.preference)
  ) {
    throw new TypeError(
      "Native accessibility change preference is unavailable on this platform.",
    );
  }
  if (typeof candidate.enabled !== "boolean") {
    throw new TypeError(
      "Native accessibility change enabled must be a boolean.",
    );
  }
  return Object.freeze({
    preference: candidate.preference as AccessibilityPreferenceKey,
    enabled: candidate.enabled,
  });
}

function announcement(
  value: string | AccessibilityAnnouncement,
  platform: AccessibilityPlatform,
): NormalizedAccessibilityAnnouncement {
  const candidate =
    typeof value === "string"
      ? { message: value }
      : record(value, "Announcement");
  if (
    typeof candidate.message !== "string" ||
    candidate.message.length === 0 ||
    candidate.message.length > ACCESSIBILITY_MAX_ANNOUNCEMENT_LENGTH ||
    candidate.message.includes("\0")
  ) {
    throw new TypeError(
      `Announcement message must be a 1-${ACCESSIBILITY_MAX_ANNOUNCEMENT_LENGTH} character string without null bytes.`,
    );
  }
  const queue = candidate.queue ?? false;
  if (typeof queue !== "boolean") {
    throw new TypeError("Announcement queue must be a boolean.");
  }
  const priority = candidate.priority ?? "default";
  if (priority !== "low" && priority !== "default" && priority !== "high") {
    throw new TypeError("Announcement priority must be low, default, or high.");
  }
  if (platform === "android" && (queue || priority !== "default")) {
    throw new TypeError(
      "Announcement queue and priority options are available only on iOS.",
    );
  }
  return Object.freeze({ message: candidate.message, queue, priority });
}

function timeoutMilliseconds(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > ACCESSIBILITY_MAX_TIMEOUT_MILLISECONDS
  ) {
    throw new RangeError(
      `${path} must be a non-negative safe integer no larger than ${ACCESSIBILITY_MAX_TIMEOUT_MILLISECONDS}.`,
    );
  }
  return value as number;
}

function reportSubscriptionError(
  error: unknown,
  options: AccessibilitySubscriptionOptions,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Native delivery and cleanup cannot be broken by a diagnostic hook.
  }
}

function subscription(value: unknown): AccessibilitySubscription {
  const candidate = record(value, "Accessibility subscription");
  if (typeof candidate.remove !== "function") {
    throw new TypeError("Accessibility subscription must provide remove().");
  }
  const remove = candidate.remove as () => void;
  let active = true;
  return Object.freeze({
    remove() {
      if (!active) return;
      active = false;
      remove.call(value);
    },
  });
}

/** Validates native accessibility queries, changes, announcements, and timeouts. */
export function createAccessibilityService(
  adapter: AccessibilityAdapter,
): AccessibilityService {
  const candidate = record(adapter, "Accessibility adapter");
  if (candidate.platform !== "android" && candidate.platform !== "ios") {
    throw new TypeError(
      "Accessibility adapter platform must be android or ios.",
    );
  }
  for (const method of [
    "getPreferences",
    "subscribe",
    "announce",
    "getRecommendedTimeoutMillis",
  ] as const) {
    if (typeof candidate[method] !== "function") {
      throw new TypeError(`Accessibility adapter must provide ${method}().`);
    }
  }
  const platform = candidate.platform;
  const allowed = allowedPreferenceKeys(platform);
  const service: AccessibilityService = {
    platform,
    async getPreferences() {
      return accessibilityPreferences(await adapter.getPreferences(), platform);
    },
    subscribe(
      listener: (change: AccessibilityPreferenceChange) => unknown,
      options: AccessibilitySubscriptionOptions = {},
    ) {
      if (typeof listener !== "function") {
        throw new TypeError("Accessibility listener must be a function.");
      }
      record(options, "Accessibility subscription options");
      if (
        options.onError !== undefined &&
        typeof options.onError !== "function"
      ) {
        throw new TypeError("Accessibility onError must be a function.");
      }
      return subscription(
        adapter.subscribe((value) => {
          try {
            listener(accessibilityChange(value, allowed));
          } catch (error) {
            reportSubscriptionError(error, options);
          }
        }),
      );
    },
    announce(value: string | AccessibilityAnnouncement) {
      adapter.announce(announcement(value, platform));
    },
    async getRecommendedTimeoutMillis(originalTimeout: number) {
      const normalized = timeoutMilliseconds(
        originalTimeout,
        "Original accessibility timeout",
      );
      const recommended = timeoutMilliseconds(
        await adapter.getRecommendedTimeoutMillis(normalized),
        "Native recommended accessibility timeout",
      );
      if (recommended < normalized) {
        throw new RangeError(
          "Native recommended accessibility timeout must not shorten the original timeout.",
        );
      }
      return recommended;
    },
  };
  return Object.freeze(service);
}
