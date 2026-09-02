import assert from "node:assert/strict";
import test from "node:test";

import { createShareService } from "../dist/index.js";
import {
  createAndroidShareAdapter,
  createIOSShareAdapter,
} from "../dist/react-native-adapter.js";

function androidModule() {
  const module = {
    content: undefined,
    dialogTitle: "not-called",
    argumentCount: 0,
    result: { action: "sharedAction" },
    share(content, dialogTitle) {
      assert.equal(this, module);
      this.content = content;
      this.dialogTitle = dialogTitle;
      this.argumentCount = arguments.length;
      return Promise.resolve(this.result);
    },
  };
  return module;
}

test("maps Android URL and message into its text-only native contract", async () => {
  const module = androidModule();
  const service = createShareService(createAndroidShareAdapter(module));
  assert.deepEqual(
    await service.share({
      message: "See this",
      url: "https://solid-native.dev",
      subject: "Native rendering",
    }),
    { action: "presented" },
  );
  assert.deepEqual(module.content, {
    title: "Native rendering",
    message: "See this\nhttps://solid-native.dev",
  });
  assert.equal(module.dialogTitle, undefined);
  assert.equal(module.argumentCount, 2);
  assert.ok(Object.isFrozen(module.content));

  await service.share({ url: "https://solid-native.dev/url-only" });
  assert.deepEqual(module.content, {
    message: "https://solid-native.dev/url-only",
  });
});

test("validates Android module shape and its fixed native action", async () => {
  assert.throws(() => createAndroidShareAdapter(null), /must be an object/u);
  assert.throws(
    () => createAndroidShareAdapter({ share: true }),
    /must provide share/u,
  );
  const module = androidModule();
  module.result = { action: "dismissedAction" };
  await assert.rejects(
    createShareService(createAndroidShareAdapter(module)).share({
      message: "x",
    }),
    /unknown share action/u,
  );
  module.share = () => {
    throw new Error("chooser launch failed");
  };
  await assert.rejects(
    createShareService(createAndroidShareAdapter(module)).share({
      message: "x",
    }),
    /chooser launch failed/u,
  );
});

function iosManager() {
  const manager = {
    options: undefined,
    onFailure: undefined,
    onSuccess: undefined,
    showShareActionSheetWithOptions(options, onFailure, onSuccess) {
      assert.equal(this, manager);
      this.options = options;
      this.onFailure = onFailure;
      this.onSuccess = onSuccess;
    },
  };
  return manager;
}

test("maps iOS activity completion and ignores duplicate callbacks", async () => {
  const manager = iosManager();
  const service = createShareService(createIOSShareAdapter(manager));
  const pending = service.share({
    message: "See this",
    url: "https://solid-native.dev",
    subject: "Native rendering",
  });
  assert.deepEqual(manager.options, {
    message: "See this",
    url: "https://solid-native.dev",
    subject: "Native rendering",
  });
  assert.ok(Object.isFrozen(manager.options));
  manager.onSuccess(true, "com.apple.UIKit.activity.Message");
  manager.onFailure(new Error("late failure"));
  manager.onSuccess(false, null);
  assert.deepEqual(await pending, {
    action: "completed",
    activityType: "com.apple.UIKit.activity.Message",
  });

  const dismissalManager = iosManager();
  const dismissal = createShareService(
    createIOSShareAdapter(dismissalManager),
  ).share({ message: "Dismiss me" });
  dismissalManager.onSuccess(false, null);
  assert.deepEqual(await dismissal, { action: "dismissed" });
});

test("validates iOS manager callbacks and bounded native failures", async () => {
  assert.throws(() => createIOSShareAdapter([]), /must be an object/u);
  assert.throws(
    () => createIOSShareAdapter({ showShareActionSheetWithOptions: true }),
    /must provide showShareActionSheetWithOptions/u,
  );

  const invalidSuccess = iosManager();
  const invalidSuccessPromise = createShareService(
    createIOSShareAdapter(invalidSuccess),
  ).share({ message: "x" });
  invalidSuccess.onSuccess("yes", null);
  await assert.rejects(invalidSuccessPromise, /completion flag/u);

  const invalidDismissal = iosManager();
  const invalidDismissalPromise = createShareService(
    createIOSShareAdapter(invalidDismissal),
  ).share({ message: "x" });
  invalidDismissal.onSuccess(false, "injected.activity");
  await assert.rejects(invalidDismissalPromise, /must not include/u);

  const invalidActivity = iosManager();
  const invalidActivityPromise = createShareService(
    createIOSShareAdapter(invalidActivity),
  ).share({ message: "x" });
  invalidActivity.onSuccess(true, 42);
  await assert.rejects(invalidActivityPromise, /activity type/u);

  const nativeFailure = iosManager();
  const nativeFailurePromise = createShareService(
    createIOSShareAdapter(nativeFailure),
  ).share({ message: "x" });
  nativeFailure.onFailure({ message: "activity controller failed" });
  await assert.rejects(nativeFailurePromise, /activity controller failed/u);

  const malformedFailure = iosManager();
  const malformedFailurePromise = createShareService(
    createIOSShareAdapter(malformedFailure),
  ).share({ message: "x" });
  malformedFailure.onFailure({ privatePayload: "must not escape" });
  await assert.rejects(malformedFailurePromise, /invalid native error/u);

  const throwingManager = iosManager();
  throwingManager.showShareActionSheetWithOptions = () => {
    throw new Error("UIKit presentation failed");
  };
  await assert.rejects(
    createShareService(createIOSShareAdapter(throwingManager)).share({
      message: "x",
    }),
    /UIKit presentation failed/u,
  );
});
