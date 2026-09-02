import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESSIBILITY_MAX_ANNOUNCEMENT_LENGTH,
  ACCESSIBILITY_MAX_TIMEOUT_MILLISECONDS,
  createAccessibilityService,
} from "../dist/index.js";

function androidPreferences(overrides = {}) {
  return {
    platform: "android",
    screenReaderEnabled: false,
    reduceMotionEnabled: true,
    invertColorsEnabled: false,
    grayscaleEnabled: false,
    highTextContrastEnabled: true,
    accessibilityServiceEnabled: true,
    ...overrides,
  };
}

function memoryAdapter(platform = "android") {
  const adapter = {
    platform,
    preferences:
      platform === "android"
        ? androidPreferences()
        : {
            platform: "ios",
            screenReaderEnabled: true,
            reduceMotionEnabled: false,
            invertColorsEnabled: false,
            grayscaleEnabled: false,
            boldTextEnabled: true,
            darkerSystemColorsEnabled: false,
            reduceTransparencyEnabled: true,
            prefersCrossFadeTransitions: false,
          },
    listener: undefined,
    announcement: undefined,
    removed: 0,
    async getPreferences() {
      return this.preferences;
    },
    subscribe(listener) {
      this.listener = listener;
      return {
        remove: () => {
          this.removed++;
        },
      };
    },
    announce(request) {
      this.announcement = request;
    },
    async getRecommendedTimeoutMillis(originalTimeout) {
      return originalTimeout + 250;
    },
  };
  return adapter;
}

test("validates and freezes platform accessibility preferences", async () => {
  const androidAdapter = memoryAdapter();
  const android = createAccessibilityService(androidAdapter);
  const snapshot = await android.getPreferences();
  assert.deepEqual(snapshot, androidPreferences());
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(android.platform, "android");
  assert.ok(Object.isFrozen(android));

  const ios = createAccessibilityService(memoryAdapter("ios"));
  assert.deepEqual(await ios.getPreferences(), {
    platform: "ios",
    screenReaderEnabled: true,
    reduceMotionEnabled: false,
    invertColorsEnabled: false,
    grayscaleEnabled: false,
    boldTextEnabled: true,
    darkerSystemColorsEnabled: false,
    reduceTransparencyEnabled: true,
    prefersCrossFadeTransitions: false,
  });
});

test("normalizes platform announcements and recommended timeouts", async () => {
  const androidAdapter = memoryAdapter();
  const android = createAccessibilityService(androidAdapter);
  android.announce("Download finished");
  assert.deepEqual(androidAdapter.announcement, {
    message: "Download finished",
    queue: false,
    priority: "default",
  });
  assert.ok(Object.isFrozen(androidAdapter.announcement));
  assert.equal(await android.getRecommendedTimeoutMillis(1_000), 1_250);

  const iosAdapter = memoryAdapter("ios");
  const ios = createAccessibilityService(iosAdapter);
  ios.announce({ message: "Saved", queue: true, priority: "high" });
  assert.deepEqual(iosAdapter.announcement, {
    message: "Saved",
    queue: true,
    priority: "high",
  });

  assert.throws(
    () => android.announce({ message: "x", queue: true }),
    /only on iOS/u,
  );
  assert.throws(
    () =>
      android.announce("x".repeat(ACCESSIBILITY_MAX_ANNOUNCEMENT_LENGTH + 1)),
    /1-4096 character/u,
  );
  await assert.rejects(
    android.getRecommendedTimeoutMillis(
      ACCESSIBILITY_MAX_TIMEOUT_MILLISECONDS + 1,
    ),
    /non-negative safe integer/u,
  );
  androidAdapter.getRecommendedTimeoutMillis = async () => 500;
  await assert.rejects(
    android.getRecommendedTimeoutMillis(1_000),
    /must not shorten/u,
  );
});

test("validates native changes and isolates listeners and diagnostics", () => {
  const adapter = memoryAdapter();
  const service = createAccessibilityService(adapter);
  const changes = [];
  const errors = [];
  const subscription = service.subscribe(
    (change) => {
      changes.push(change);
      if (change.preference === "reduceMotionEnabled") {
        throw new Error("application listener failed");
      }
    },
    { onError: (error) => errors.push(error) },
  );

  adapter.listener({ preference: "screenReaderEnabled", enabled: true });
  adapter.listener({ preference: "reduceMotionEnabled", enabled: false });
  adapter.listener({ preference: "boldTextEnabled", enabled: true });
  adapter.listener({ preference: "grayscaleEnabled", enabled: "yes" });
  assert.deepEqual(changes, [
    { preference: "screenReaderEnabled", enabled: true },
    { preference: "reduceMotionEnabled", enabled: false },
  ]);
  assert.ok(Object.isFrozen(changes[0]));
  assert.equal(errors.length, 3);
  subscription.remove();
  subscription.remove();
  assert.equal(adapter.removed, 1);
});

test("rejects malformed adapters, preferences, subscriptions, and results", async () => {
  assert.throws(() => createAccessibilityService({}), /platform/u);
  assert.throws(
    () =>
      createAccessibilityService({
        platform: "web",
        getPreferences() {},
        subscribe() {},
        announce() {},
        getRecommendedTimeoutMillis() {},
      }),
    /android or ios/u,
  );
  const missingMethod = memoryAdapter();
  missingMethod.announce = true;
  assert.throws(
    () => createAccessibilityService(missingMethod),
    /must provide announce/u,
  );

  const adapter = memoryAdapter();
  const service = createAccessibilityService(adapter);
  adapter.preferences = androidPreferences({ screenReaderEnabled: "yes" });
  await assert.rejects(service.getPreferences(), /must be a boolean/u);
  adapter.preferences = { ...androidPreferences(), platform: "ios" };
  await assert.rejects(service.getPreferences(), /match the service platform/u);
  adapter.subscribe = () => ({ remove: true });
  assert.throws(() => service.subscribe(() => undefined), /provide remove/u);
  adapter.getRecommendedTimeoutMillis = async () => 1.5;
  await assert.rejects(
    service.getRecommendedTimeoutMillis(1),
    /non-negative safe integer/u,
  );
});
