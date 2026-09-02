import {
  createCausalPlatformEventHandler,
  type AppStateSource,
  type AppStateStatus,
} from "@solid-native/core";
import {
  action,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

import {
  type AccessibilityAnnouncement,
  type AccessibilityPreferenceChange,
  type AccessibilityPreferenceKey,
  type AccessibilityPreferences,
  type AccessibilityService,
  type AndroidAccessibilityPreferences,
  type IOSAccessibilityPreferences,
} from "./index.js";

export type AccessibilityPreferencesStatus =
  "loading" | "ready" | "refreshing" | "error";

export interface AccessibilityPreferencesOptions {
  /** Refreshes the complete native snapshot after each inactive-to-active transition. */
  readonly appState?: AppStateSource;
  readonly onError?: (error: unknown) => unknown;
}

export interface AccessibilityPreferencesControllerCommon {
  readonly platform: "android" | "ios";
  readonly status: Accessor<AccessibilityPreferencesStatus>;
  readonly error: Accessor<unknown>;
  readonly snapshot: Accessor<AccessibilityPreferences | undefined>;
  /** Settles with the owner-bound initial native preference query. */
  readonly ready: Promise<void>;
  readonly screenReaderEnabled: Accessor<boolean | undefined>;
  readonly reduceMotionEnabled: Accessor<boolean | undefined>;
  readonly invertColorsEnabled: Accessor<boolean | undefined>;
  readonly grayscaleEnabled: Accessor<boolean | undefined>;
  refresh(): Promise<void>;
  announce(request: string | AccessibilityAnnouncement): void;
  getRecommendedTimeoutMillis(originalTimeout: number): Promise<number>;
}

export interface AndroidAccessibilityPreferencesController extends AccessibilityPreferencesControllerCommon {
  readonly platform: "android";
  readonly snapshot: Accessor<AndroidAccessibilityPreferences | undefined>;
  readonly highTextContrastEnabled: Accessor<boolean | undefined>;
  readonly accessibilityServiceEnabled: Accessor<boolean | undefined>;
}

export interface IOSAccessibilityPreferencesController extends AccessibilityPreferencesControllerCommon {
  readonly platform: "ios";
  readonly snapshot: Accessor<IOSAccessibilityPreferences | undefined>;
  readonly boldTextEnabled: Accessor<boolean | undefined>;
  readonly darkerSystemColorsEnabled: Accessor<boolean | undefined>;
  readonly reduceTransparencyEnabled: Accessor<boolean | undefined>;
  readonly prefersCrossFadeTransitions: Accessor<boolean | undefined>;
}

export type AccessibilityPreferencesController =
  | AndroidAccessibilityPreferencesController
  | IOSAccessibilityPreferencesController;

function reportError(
  error: unknown,
  options: AccessibilityPreferencesOptions,
): void {
  try {
    const reported = options.onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostics cannot break native delivery, refresh, or owner cleanup.
  }
}

function validateService(service: AccessibilityService): void {
  if (service === null || typeof service !== "object") {
    throw new TypeError(
      "Accessibility preferences require an AccessibilityService.",
    );
  }
  if (service.platform !== "android" && service.platform !== "ios") {
    throw new TypeError(
      "Accessibility service platform must be android or ios.",
    );
  }
  for (const method of [
    "getPreferences",
    "subscribe",
    "announce",
    "getRecommendedTimeoutMillis",
  ] as const) {
    if (typeof service[method] !== "function") {
      throw new TypeError(`Accessibility service must provide ${method}().`);
    }
  }
}

function validateAppStateSource(source: AppStateSource | undefined): void {
  if (source === undefined) return;
  if (source === null || typeof source !== "object") {
    throw new TypeError("Accessibility appState must be an AppStateSource.");
  }
  if (
    source.initialAppState !== "active" &&
    source.initialAppState !== "background" &&
    source.initialAppState !== "extension" &&
    source.initialAppState !== "inactive" &&
    source.initialAppState !== "unknown"
  ) {
    throw new TypeError(
      "Accessibility appState initialAppState is unsupported.",
    );
  }
  if (typeof source.subscribeAppState !== "function") {
    throw new TypeError(
      "Accessibility appState must provide subscribeAppState().",
    );
  }
}

function validateAppStateStatus(value: unknown): AppStateStatus {
  if (
    value !== "active" &&
    value !== "background" &&
    value !== "extension" &&
    value !== "inactive" &&
    value !== "unknown"
  ) {
    throw new TypeError(
      "Accessibility appState delivered an unsupported state.",
    );
  }
  return value;
}

function applyChanges(
  snapshot: AccessibilityPreferences,
  changes: ReadonlyMap<
    AccessibilityPreferenceKey,
    Readonly<{ enabled: boolean; revision: number }>
  >,
  afterRevision = -1,
): AccessibilityPreferences {
  const next: Record<string, unknown> = { ...snapshot };
  for (const [preference, change] of changes) {
    if (change.revision > afterRevision) next[preference] = change.enabled;
  }
  return Object.freeze(next) as unknown as AccessibilityPreferences;
}

/**
 * Loads accessibility preferences, projects changes into fine-grained Solid
 * accessors, and owns the native subscription with the current Solid owner.
 * Preference values and announcement content are not causal telemetry fields.
 */
export function createAccessibilityPreferences(
  service: AccessibilityService,
  options: AccessibilityPreferencesOptions = {},
): AccessibilityPreferencesController {
  validateService(service);
  if (getOwner() === null) {
    throw new Error(
      "createAccessibilityPreferences requires an active Solid owner.",
    );
  }
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("Accessibility preferences options must be an object.");
  }
  if (options.onError !== undefined && typeof options.onError !== "function") {
    throw new TypeError(
      "Accessibility preferences onError must be a function.",
    );
  }
  validateAppStateSource(options.appState);

  const [snapshot, setSnapshot] = createSignal<
    AccessibilityPreferences | undefined
  >();
  const [status, setStatus] =
    createSignal<AccessibilityPreferencesStatus>("loading");
  const [error, setError] = createSignal<unknown>();
  const latestChanges = new Map<
    AccessibilityPreferenceKey,
    Readonly<{ enabled: boolean; revision: number }>
  >();
  let active = true;
  let changeRevision = 0;
  let hasLoaded = false;
  let refreshSequence = 0;

  const publishError = (failure: unknown): void => {
    setError(() => failure);
    reportError(failure, options);
  };
  const applyChange = createCausalPlatformEventHandler(
    "platform.accessibility.preference",
    (change: AccessibilityPreferenceChange) => {
      if (!active) return;
      latestChanges.set(change.preference, {
        enabled: change.enabled,
        revision: ++changeRevision,
      });
      const current = untrack(snapshot);
      if (current === undefined) return;
      setSnapshot(applyChanges(current, latestChanges, changeRevision - 1));
      setError(undefined);
      setStatus("ready");
    },
  );
  const subscription = service.subscribe(
    (change) => {
      if (!active) return;
      applyChange(change);
    },
    {
      onError: publishError,
    },
  );

  const runRefresh = action(function* (): Generator<
    Promise<AccessibilityPreferences>,
    void,
    AccessibilityPreferences
  > {
    if (!active) return;
    const sequence = ++refreshSequence;
    // Before the first successful query, retain any event delivered after the
    // subscription was installed. Later queries need only overlay events that
    // raced that specific native request; older events are already reflected
    // by the platform query and must not make refresh() permanently stale.
    const queryStartRevision = hasLoaded ? changeRevision : -1;
    setStatus(untrack(snapshot) === undefined ? "loading" : "refreshing");
    setError(undefined);
    try {
      const next = yield service.getPreferences();
      if (!active || sequence !== refreshSequence) return;
      setSnapshot(applyChanges(next, latestChanges, queryStartRevision));
      hasLoaded = true;
      setStatus("ready");
    } catch (failure) {
      if (!active || sequence !== refreshSequence) return;
      setStatus("error");
      publishError(failure);
      throw failure;
    }
  });
  const refresh = (): Promise<void> => {
    return runRefresh() as unknown as Promise<void>;
  };

  let appStateSubscription: Readonly<{ remove(): void }> | undefined;
  if (options.appState !== undefined) {
    let wasActive = options.appState.initialAppState === "active";
    try {
      appStateSubscription = options.appState.subscribeAppState((value) => {
        if (!active) return;
        let state: AppStateStatus;
        try {
          state = validateAppStateStatus(value);
        } catch (failure) {
          publishError(failure);
          return;
        }
        const isActive = state === "active";
        if (isActive && !wasActive) {
          // A source may deliver synchronously while a component is being
          // constructed. Start the Solid action after the owned computation.
          void Promise.resolve()
            .then(refresh)
            .catch(() => undefined);
        }
        wasActive = isActive;
      });
      if (
        appStateSubscription === null ||
        typeof appStateSubscription !== "object" ||
        typeof appStateSubscription.remove !== "function"
      ) {
        throw new TypeError(
          "Accessibility appState subscription must provide remove().",
        );
      }
    } catch (failure) {
      // A source may synchronously request a refresh before failing setup.
      // Retire the controller before rolling back its first subscription so
      // that queued work cannot outlive the failed construction.
      active = false;
      refreshSequence++;
      try {
        subscription.remove();
      } catch (cleanupFailure) {
        reportError(cleanupFailure, options);
      }
      throw failure;
    }
  }

  onCleanup(() => {
    if (!active) return;
    active = false;
    refreshSequence++;
    try {
      subscription.remove();
    } catch (failure) {
      reportError(failure, options);
    }
    try {
      appStateSubscription?.remove();
    } catch (failure) {
      reportError(failure, options);
    }
  });

  // Component construction is an owned computation in Solid 2. Start the
  // initial imperative action after that computation returns.
  const ready = Promise.resolve().then(refresh);
  void ready.catch(() => undefined);
  const common = {
    platform: service.platform,
    status,
    error,
    snapshot,
    ready,
    screenReaderEnabled: createMemo(() => snapshot()?.screenReaderEnabled),
    reduceMotionEnabled: createMemo(() => snapshot()?.reduceMotionEnabled),
    invertColorsEnabled: createMemo(() => snapshot()?.invertColorsEnabled),
    grayscaleEnabled: createMemo(() => snapshot()?.grayscaleEnabled),
    refresh,
    announce(request: string | AccessibilityAnnouncement) {
      service.announce(request);
    },
    getRecommendedTimeoutMillis(originalTimeout: number) {
      return service.getRecommendedTimeoutMillis(originalTimeout);
    },
  };
  if (service.platform === "android") {
    return Object.freeze({
      ...common,
      platform: "android" as const,
      snapshot: snapshot as Accessor<
        AndroidAccessibilityPreferences | undefined
      >,
      highTextContrastEnabled: createMemo(() => {
        const value = snapshot();
        return value?.platform === "android"
          ? value.highTextContrastEnabled
          : undefined;
      }),
      accessibilityServiceEnabled: createMemo(() => {
        const value = snapshot();
        return value?.platform === "android"
          ? value.accessibilityServiceEnabled
          : undefined;
      }),
    });
  }
  return Object.freeze({
    ...common,
    platform: "ios" as const,
    snapshot: snapshot as Accessor<IOSAccessibilityPreferences | undefined>,
    boldTextEnabled: createMemo(() => {
      const value = snapshot();
      return value?.platform === "ios" ? value.boldTextEnabled : undefined;
    }),
    darkerSystemColorsEnabled: createMemo(() => {
      const value = snapshot();
      return value?.platform === "ios"
        ? value.darkerSystemColorsEnabled
        : undefined;
    }),
    reduceTransparencyEnabled: createMemo(() => {
      const value = snapshot();
      return value?.platform === "ios"
        ? value.reduceTransparencyEnabled
        : undefined;
    }),
    prefersCrossFadeTransitions: createMemo(() => {
      const value = snapshot();
      return value?.platform === "ios"
        ? value.prefersCrossFadeTransitions
        : undefined;
    }),
  });
}

export type {
  AccessibilityAnnouncement,
  AccessibilityAnnouncementPriority,
  AccessibilityPlatform,
  AccessibilityPreferenceChange,
  AccessibilityPreferenceKey,
  AccessibilityPreferences,
  AccessibilityService,
  AccessibilitySubscription,
  AndroidAccessibilityPreferences,
  IOSAccessibilityPreferences,
} from "./index.js";

export type { AppStateSource, AppStateStatus } from "@solid-native/core";
