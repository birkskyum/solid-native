import assert from "node:assert/strict";
import test from "node:test";

import { createAlertService } from "../dist/index.js";
import {
  createAndroidAlertAdapter,
  createIOSAlertAdapter,
} from "../dist/react-native-adapter.js";

function androidManager() {
  const manager = {
    configuration: undefined,
    onAction: undefined,
    onError: undefined,
    getConstants() {
      assert.equal(this, manager);
      return {
        buttonClicked: "buttonClicked",
        dismissed: "dismissed",
        buttonPositive: -1,
        buttonNegative: -2,
        buttonNeutral: -3,
      };
    },
    showAlert(configuration, onError, onAction) {
      assert.equal(this, manager);
      this.configuration = configuration;
      this.onError = onError;
      this.onAction = onAction;
    },
  };
  return manager;
}

test("maps stable Android button order onto neutral, negative, and positive", async () => {
  const manager = androidManager();
  const service = createAlertService(createAndroidAlertAdapter(manager));
  const pending = service.show({
    title: "Three choices",
    message: "Native order",
    cancelable: true,
    buttons: [
      { id: "first", text: "First" },
      { id: "second", text: "Second" },
      { id: "third", text: "Third" },
    ],
  });

  assert.deepEqual(manager.configuration, {
    title: "Three choices",
    message: "Native order",
    cancelable: true,
    buttonNeutral: "First",
    buttonNegative: "Second",
    buttonPositive: "Third",
  });
  assert.ok(Object.isFrozen(manager.configuration));
  manager.onAction("buttonClicked", -3);
  manager.onAction("buttonClicked", -1);
  manager.onError("late native error");
  assert.deepEqual(await pending, { action: "button", buttonId: "first" });

  const secondManager = androidManager();
  const secondService = createAlertService(
    createAndroidAlertAdapter(secondManager),
  );
  const secondPending = secondService.show({
    title: "Two choices",
    buttons: [
      { id: "negative", text: "Negative" },
      { id: "positive", text: "Positive" },
    ],
  });
  assert.equal(secondManager.configuration.buttonNeutral, undefined);
  secondManager.onAction("buttonClicked", -1);
  assert.deepEqual(await secondPending, {
    action: "button",
    buttonId: "positive",
  });
});

test("normalizes Android dismissal and rejects invalid native callbacks", async () => {
  const dismissedManager = androidManager();
  const dismissed = createAlertService(
    createAndroidAlertAdapter(dismissedManager),
  ).show({ title: "Dismiss" });
  dismissedManager.onAction("dismissed");
  assert.deepEqual(await dismissed, { action: "dismissed" });

  const unknownActionManager = androidManager();
  const unknownAction = createAlertService(
    createAndroidAlertAdapter(unknownActionManager),
  ).show({ title: "Unknown action" });
  unknownActionManager.onAction("teleported", -1);
  await assert.rejects(unknownAction, /unknown alert action/u);

  const unknownKeyManager = androidManager();
  const unknownKey = createAlertService(
    createAndroidAlertAdapter(unknownKeyManager),
  ).show({ title: "Unknown key" });
  unknownKeyManager.onAction("buttonClicked", -3);
  await assert.rejects(unknownKey, /unknown alert button key/u);

  const malformedKeyManager = androidManager();
  const malformedKey = createAlertService(
    createAndroidAlertAdapter(malformedKeyManager),
  ).show({ title: "Malformed key" });
  malformedKeyManager.onAction("buttonClicked", "-1");
  await assert.rejects(malformedKey, /safe integer/u);

  const nativeErrorManager = androidManager();
  const nativeError = createAlertService(
    createAndroidAlertAdapter(nativeErrorManager),
  ).show({ title: "Native error" });
  nativeErrorManager.onError("presentation failed");
  await assert.rejects(nativeError, /presentation failed/u);

  const boundedErrorManager = androidManager();
  const boundedError = createAlertService(
    createAndroidAlertAdapter(boundedErrorManager),
  ).show({ title: "Bounded error" });
  boundedErrorManager.onError("x".repeat(4_097));
  await assert.rejects(boundedError, /reported an invalid error/u);
});

test("validates the Android manager before presenting application data", () => {
  assert.throws(() => createAndroidAlertAdapter(null), /must be an object/u);
  assert.throws(
    () => createAndroidAlertAdapter({ getConstants() {} }),
    /provide getConstants.*showAlert/u,
  );
  const duplicate = androidManager();
  duplicate.getConstants = () => ({
    buttonClicked: "buttonClicked",
    dismissed: "dismissed",
    buttonPositive: -1,
    buttonNegative: -1,
    buttonNeutral: -3,
  });
  assert.throws(
    () => createAndroidAlertAdapter(duplicate),
    /must be distinct/u,
  );
  const invalidActions = androidManager();
  invalidActions.getConstants = () => ({
    buttonClicked: "same",
    dismissed: "same",
    buttonPositive: -1,
    buttonNegative: -2,
    buttonNeutral: -3,
  });
  assert.throws(
    () => createAndroidAlertAdapter(invalidActions),
    /action constants are invalid/u,
  );
});

function iosManager() {
  const manager = {
    configuration: undefined,
    callback: undefined,
    alertWithArgs(configuration, callback) {
      assert.equal(this, manager);
      this.configuration = configuration;
      this.callback = callback;
    },
  };
  return manager;
}

test("maps iOS button styles and accepts its native string button key", async () => {
  const manager = iosManager();
  const service = createAlertService(createIOSAlertAdapter(manager));
  const pending = service.show({
    title: "iOS choices",
    message: "Native metadata",
    userInterfaceStyle: "dark",
    buttons: [
      { id: "cancel", text: "Cancel", style: "cancel" },
      { id: "remove", text: "Remove", style: "destructive" },
      { id: "save", text: "Save", preferred: true },
    ],
  });

  assert.deepEqual(manager.configuration, {
    title: "iOS choices",
    message: "Native metadata",
    buttons: [{ 0: "Cancel" }, { 1: "Remove" }, { 2: "Save" }],
    type: "default",
    cancelButtonKey: "0",
    destructiveButtonKey: "1",
    preferredButtonKey: "2",
    userInterfaceStyle: "dark",
  });
  assert.ok(Object.isFrozen(manager.configuration));
  assert.ok(Object.isFrozen(manager.configuration.buttons));
  assert.ok(Object.isFrozen(manager.configuration.buttons[0]));
  manager.callback("2");
  manager.callback(0, "late value");
  assert.deepEqual(await pending, { action: "button", buttonId: "save" });
});

test("accepts the numeric iOS button index declared by React Native's spec", async () => {
  const manager = iosManager();
  const pending = createAlertService(createIOSAlertAdapter(manager)).show({
    title: "Declared callback",
    buttons: [
      { id: "cancel", text: "Cancel", style: "cancel" },
      { id: "continue", text: "Continue" },
    ],
  });
  manager.callback(1);
  assert.deepEqual(await pending, {
    action: "button",
    buttonId: "continue",
  });
});

test("rejects invalid iOS manager and callback values", async () => {
  assert.throws(() => createIOSAlertAdapter([]), /must be an object/u);
  assert.throws(
    () => createIOSAlertAdapter({ alertWithArgs: true }),
    /provide alertWithArgs/u,
  );

  const outOfRangeManager = iosManager();
  const outOfRange = createAlertService(
    createIOSAlertAdapter(outOfRangeManager),
  ).show({ title: "Out of range" });
  outOfRangeManager.callback(1);
  await assert.rejects(outOfRange, /invalid alert callback/u);

  const malformedManager = iosManager();
  const malformed = createAlertService(
    createIOSAlertAdapter(malformedManager),
  ).show({ title: "Malformed" });
  malformedManager.callback("00");
  await assert.rejects(malformed, /invalid alert callback/u);

  const throwingManager = iosManager();
  throwingManager.alertWithArgs = () => {
    throw new Error("UIKit presentation failed");
  };
  await assert.rejects(
    createAlertService(createIOSAlertAdapter(throwingManager)).show({
      title: "Throw",
    }),
    /UIKit presentation failed/u,
  );
});
