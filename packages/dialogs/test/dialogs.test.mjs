import assert from "node:assert/strict";
import test from "node:test";

import {
  ALERT_MAX_ANDROID_BUTTONS,
  ALERT_MAX_BUTTON_ID_LENGTH,
  ALERT_MAX_IOS_BUTTONS,
  ALERT_MAX_MESSAGE_LENGTH,
  ALERT_MAX_TITLE_LENGTH,
  AlertPresentationInProgressError,
  createAlertService,
} from "../dist/index.js";

function memoryAdapter(platform = "android") {
  return {
    platform,
    lastRequest: undefined,
    result: { action: "button", buttonId: "ok" },
    async showAlert(request) {
      this.lastRequest = request;
      return this.result;
    },
  };
}

test("normalizes a portable alert and validates its native result", async () => {
  const adapter = memoryAdapter();
  const service = createAlertService(adapter);
  const result = await service.show({ title: "Solid Native" });

  assert.deepEqual(result, { action: "button", buttonId: "ok" });
  assert.equal(service.platform, "android");
  assert.deepEqual(adapter.lastRequest, {
    title: "Solid Native",
    buttons: [{ id: "ok", text: "OK", style: "default", preferred: false }],
    cancelable: false,
    userInterfaceStyle: "system",
  });
  assert.ok(Object.isFrozen(service));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(adapter.lastRequest));
  assert.ok(Object.isFrozen(adapter.lastRequest.buttons));
  assert.ok(Object.isFrozen(adapter.lastRequest.buttons[0]));
});

test("preserves bounded button identities and Android dismissal", async () => {
  const adapter = memoryAdapter();
  adapter.result = { action: "dismissed" };
  const service = createAlertService(adapter);
  assert.deepEqual(
    await service.show({
      message: "Choose carefully",
      cancelable: true,
      buttons: [
        { id: "later", text: "Later", style: "cancel" },
        { id: "remove", text: "Remove", style: "destructive" },
        { id: "save", text: "Save", preferred: true },
      ],
    }),
    { action: "dismissed" },
  );
  assert.deepEqual(
    adapter.lastRequest.buttons.map((button) => button.id),
    ["later", "remove", "save"],
  );
});

test("enforces platform capabilities and bounded application input", async () => {
  const android = createAlertService(memoryAdapter("android"));
  const ios = createAlertService(memoryAdapter("ios"));

  await assert.rejects(android.show({}), /non-empty title or message/u);
  await assert.rejects(
    android.show({ title: "x", buttons: [] }),
    /non-empty array/u,
  );
  await assert.rejects(
    android.show({
      title: "x",
      buttons: Array.from(
        { length: ALERT_MAX_ANDROID_BUTTONS + 1 },
        (_, index) => ({ id: `button-${index}`, text: `${index}` }),
      ),
    }),
    /Android alerts support at most 3 buttons/u,
  );
  await assert.rejects(
    ios.show({
      title: "x",
      buttons: Array.from(
        { length: ALERT_MAX_IOS_BUTTONS + 1 },
        (_, index) => ({ id: `button-${index}`, text: `${index}` }),
      ),
    }),
    /iOS alerts support at most 32 buttons/u,
  );
  await assert.rejects(
    android.show({ title: "x", userInterfaceStyle: "dark" }),
    /iOS-only/u,
  );
  await assert.rejects(
    ios.show({ title: "x", cancelable: true }),
    /Android-only/u,
  );
  await assert.rejects(
    android.show({ title: "x", message: "\0" }),
    /null bytes/u,
  );
  await assert.rejects(
    android.show({ title: "x".repeat(ALERT_MAX_TITLE_LENGTH + 1) }),
    /0-512 character/u,
  );
  await assert.rejects(
    android.show({ message: "x".repeat(ALERT_MAX_MESSAGE_LENGTH + 1) }),
    /0-4096 character/u,
  );
  await assert.rejects(
    android.show({
      title: "x",
      buttons: [
        { id: "same", text: "One" },
        { id: "same", text: "Two" },
      ],
    }),
    /duplicated/u,
  );
  await assert.rejects(
    android.show({
      title: "x",
      buttons: [
        { id: "one", text: "One", style: "cancel" },
        { id: "two", text: "Two", style: "cancel" },
      ],
    }),
    /at most one cancel/u,
  );
  await assert.rejects(
    android.show({
      title: "x",
      buttons: [
        { id: "one", text: "One", preferred: true },
        { id: "two", text: "Two", preferred: true },
      ],
    }),
    /at most one preferred/u,
  );
  await assert.rejects(
    ios.show({
      title: "x",
      buttons: [
        { id: "one", text: "One", style: "destructive" },
        { id: "two", text: "Two", style: "destructive" },
      ],
    }),
    /at most one destructive/u,
  );
  await assert.rejects(
    android.show({
      title: "x",
      buttons: [
        {
          id: "x".repeat(ALERT_MAX_BUTTON_ID_LENGTH + 1),
          text: "Too long",
        },
      ],
    }),
    /1-128 character/u,
  );
});

test("rejects malformed adapters and untrusted native results", async () => {
  assert.throws(() => createAlertService({}), /platform/u);
  assert.throws(
    () => createAlertService({ platform: "web", showAlert() {} }),
    /android or ios/u,
  );
  assert.throws(
    () => createAlertService({ platform: "ios", showAlert: true }),
    /showAlert/u,
  );

  const adapter = memoryAdapter();
  const service = createAlertService(adapter);
  adapter.result = { action: "button", buttonId: "native-injection" };
  await assert.rejects(service.show({ title: "x" }), /unknown button id/u);
  adapter.result = { action: "dismissed", buttonId: "ok" };
  await assert.rejects(service.show({ title: "x" }), /must not contain/u);
  adapter.result = { action: "teleported" };
  await assert.rejects(service.show({ title: "x" }), /button or dismissed/u);
  adapter.showAlert = async () => {
    throw new Error("native presentation failed");
  };
  await assert.rejects(
    service.show({ title: "x" }),
    /native presentation failed/u,
  );
});

test("rejects overlapping native presentation instead of replacing it", async () => {
  let resolvePresentation;
  const adapter = {
    platform: "android",
    showAlert() {
      return new Promise((resolve) => {
        resolvePresentation = resolve;
      });
    },
  };
  const service = createAlertService(adapter);
  const first = service.show({ title: "First" });
  await assert.rejects(
    service.show({ title: "Second" }),
    AlertPresentationInProgressError,
  );
  resolvePresentation({ action: "button", buttonId: "ok" });
  assert.deepEqual(await first, { action: "button", buttonId: "ok" });

  const third = service.show({ title: "Third" });
  resolvePresentation({ action: "dismissed" });
  assert.deepEqual(await third, { action: "dismissed" });
});
