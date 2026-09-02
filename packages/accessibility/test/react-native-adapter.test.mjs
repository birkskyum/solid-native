import assert from "node:assert/strict";
import test from "node:test";

import { createAccessibilityService } from "../dist/index.js";
import {
  createAndroidAccessibilityAdapter,
  createIOSAccessibilityAdapter,
} from "../dist/react-native-adapter.js";

function emitter() {
  const listeners = new Map();
  const removed = [];
  return {
    listeners,
    removed,
    addListener(name, listener) {
      listeners.set(name, listener);
      return {
        remove() {
          removed.push(name);
          listeners.delete(name);
        },
      };
    },
  };
}

function androidModule() {
  return {
    announcement: undefined,
    timeout: undefined,
    isTouchExplorationEnabled(callback) {
      callback(true);
    },
    isReduceMotionEnabled(callback) {
      callback(false);
    },
    isInvertColorsEnabled(callback) {
      callback(false);
    },
    isGrayscaleEnabled(callback) {
      callback(true);
    },
    isHighTextContrastEnabled(callback) {
      callback(true);
    },
    isAccessibilityServiceEnabled(callback) {
      callback(true);
    },
    announceForAccessibility(message) {
      this.announcement = message;
    },
    getRecommendedTimeoutMillis(original, callback) {
      this.timeout = original;
      callback(original + 500);
    },
  };
}

test("drives the complete Android accessibility ABI and event mapping", async () => {
  const module = androidModule();
  const events = emitter();
  const service = createAccessibilityService(
    createAndroidAccessibilityAdapter(module, events),
  );
  assert.deepEqual(await service.getPreferences(), {
    platform: "android",
    screenReaderEnabled: true,
    reduceMotionEnabled: false,
    invertColorsEnabled: false,
    grayscaleEnabled: true,
    highTextContrastEnabled: true,
    accessibilityServiceEnabled: true,
  });
  service.announce("Hello Android");
  assert.equal(module.announcement, "Hello Android");
  assert.equal(await service.getRecommendedTimeoutMillis(1_000), 1_500);
  assert.equal(module.timeout, 1_000);

  const changes = [];
  const subscription = service.subscribe((change) => changes.push(change));
  assert.deepEqual(
    [...events.listeners.keys()],
    [
      "touchExplorationDidChange",
      "reduceMotionDidChange",
      "invertColorDidChange",
      "grayscaleModeDidChange",
      "highTextContrastDidChange",
      "accessibilityServiceDidChange",
    ],
  );
  events.listeners.get("touchExplorationDidChange")(false);
  events.listeners.get("highTextContrastDidChange")(false);
  assert.deepEqual(changes, [
    { preference: "screenReaderEnabled", enabled: false },
    { preference: "highTextContrastEnabled", enabled: false },
  ]);
  subscription.remove();
  assert.equal(events.removed.length, 6);
});

function iosModule() {
  const values = {
    getCurrentVoiceOverState: true,
    getCurrentReduceMotionState: true,
    getCurrentInvertColorsState: false,
    getCurrentGrayscaleState: false,
    getCurrentBoldTextState: true,
    getCurrentDarkerSystemColorsState: true,
    getCurrentReduceTransparencyState: false,
    getCurrentPrefersCrossFadeTransitionsState: true,
  };
  const module = {
    announcement: undefined,
    ...Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        (success) => success(value),
      ]),
    ),
    announceForAccessibilityWithOptions(message, options) {
      this.announcement = { message, options };
    },
  };
  return module;
}

test("drives the complete iOS accessibility ABI and event mapping", async () => {
  const module = iosModule();
  const events = emitter();
  const service = createAccessibilityService(
    createIOSAccessibilityAdapter(module, events),
  );
  assert.deepEqual(await service.getPreferences(), {
    platform: "ios",
    screenReaderEnabled: true,
    reduceMotionEnabled: true,
    invertColorsEnabled: false,
    grayscaleEnabled: false,
    boldTextEnabled: true,
    darkerSystemColorsEnabled: true,
    reduceTransparencyEnabled: false,
    prefersCrossFadeTransitions: true,
  });
  service.announce({ message: "Hello iOS", queue: true, priority: "low" });
  assert.deepEqual(module.announcement, {
    message: "Hello iOS",
    options: { queue: true, priority: "low" },
  });
  assert.ok(Object.isFrozen(module.announcement.options));
  assert.equal(await service.getRecommendedTimeoutMillis(2_000), 2_000);

  const changes = [];
  const subscription = service.subscribe((change) => changes.push(change));
  events.listeners.get("screenReaderChanged")(false);
  events.listeners.get("boldTextChanged")(false);
  assert.deepEqual(changes, [
    { preference: "screenReaderEnabled", enabled: false },
    { preference: "boldTextEnabled", enabled: false },
  ]);
  subscription.remove();
  assert.equal(events.removed.length, 7);
});

test("fails closed for incomplete native modules and native errors", async () => {
  assert.throws(
    () => createAndroidAccessibilityAdapter({}, emitter()),
    /isTouchExplorationEnabled/u,
  );
  assert.throws(
    () => createIOSAccessibilityAdapter({}, emitter()),
    /getCurrentVoiceOverState/u,
  );
  assert.throws(
    () => createAndroidAccessibilityAdapter(androidModule(), {}),
    /addListener/u,
  );

  const throwing = androidModule();
  throwing.isReduceMotionEnabled = () => {
    throw new Error("Android query failed");
  };
  await assert.rejects(
    createAccessibilityService(
      createAndroidAccessibilityAdapter(throwing, emitter()),
    ).getPreferences(),
    /Android query failed/u,
  );

  const failing = iosModule();
  failing.getCurrentVoiceOverState = (_success, failure) =>
    failure({ message: "VoiceOver query failed" });
  await assert.rejects(
    createAccessibilityService(
      createIOSAccessibilityAdapter(failing, emitter()),
    ).getPreferences(),
    /VoiceOver query failed/u,
  );
});
