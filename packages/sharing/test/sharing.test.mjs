import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARE_MAX_ACTIVITY_TYPE_LENGTH,
  SHARE_MAX_MESSAGE_LENGTH,
  SHARE_MAX_SUBJECT_LENGTH,
  SHARE_MAX_URL_LENGTH,
  SharePresentationInProgressError,
  createShareService,
} from "../dist/index.js";

function memoryAdapter(platform = "android") {
  return {
    platform,
    lastRequest: undefined,
    result:
      platform === "android"
        ? { action: "presented" }
        : { action: "dismissed" },
    async showShareSheet(request) {
      this.lastRequest = request;
      return this.result;
    },
  };
}

test("normalizes bounded share content and freezes its public result", async () => {
  const adapter = memoryAdapter();
  const service = createShareService(adapter);
  const result = await service.share({
    message: "Rendered by Solid",
    url: "https://solid-native.dev/start",
    subject: "Solid Native",
  });

  assert.equal(service.platform, "android");
  assert.deepEqual(adapter.lastRequest, {
    message: "Rendered by Solid",
    url: "https://solid-native.dev/start",
    subject: "Solid Native",
  });
  assert.deepEqual(result, { action: "presented" });
  assert.ok(Object.isFrozen(service));
  assert.ok(Object.isFrozen(adapter.lastRequest));
  assert.ok(Object.isFrozen(result));
});

test("preserves truthful iOS completion and dismissal results", async () => {
  const adapter = memoryAdapter("ios");
  const service = createShareService(adapter);
  adapter.result = {
    action: "completed",
    activityType: "com.apple.UIKit.activity.CopyToPasteboard",
  };
  assert.deepEqual(await service.share({ message: "Copy me" }), {
    action: "completed",
    activityType: "com.apple.UIKit.activity.CopyToPasteboard",
  });

  adapter.result = { action: "dismissed" };
  assert.deepEqual(await service.share({ url: "mailto:hello@example.com" }), {
    action: "dismissed",
  });
});

test("rejects malformed or unbounded application input", async () => {
  const service = createShareService(memoryAdapter());

  await assert.rejects(service.share({}), /non-empty message or URL/u);
  await assert.rejects(service.share({ message: "" }), /1-65536/u);
  await assert.rejects(
    service.share({ message: "x".repeat(SHARE_MAX_MESSAGE_LENGTH + 1) }),
    /1-65536/u,
  );
  await assert.rejects(
    service.share({ url: "x".repeat(SHARE_MAX_URL_LENGTH + 1) }),
    /1-8192/u,
  );
  await assert.rejects(
    service.share({ url: "solid-native.dev/no-scheme" }),
    /absolute URI/u,
  );
  await assert.rejects(
    service.share({ url: "https://solid-native.dev/\nprivate" }),
    /ASCII control/u,
  );
  await assert.rejects(service.share({ message: "x", subject: "" }), /1-512/u);
  await assert.rejects(
    service.share({
      message: "x",
      subject: "x".repeat(SHARE_MAX_SUBJECT_LENGTH + 1),
    }),
    /1-512/u,
  );
  await assert.rejects(service.share(null), /plain object/u);
});

test("validates adapters and untrusted native results by platform", async () => {
  assert.throws(() => createShareService(null), /plain object/u);
  assert.throws(
    () => createShareService({ platform: "web", showShareSheet() {} }),
    /android or ios/u,
  );
  assert.throws(
    () => createShareService({ platform: "ios", showShareSheet: true }),
    /showShareSheet/u,
  );

  const androidAdapter = memoryAdapter();
  const android = createShareService(androidAdapter);
  androidAdapter.result = { action: "completed" };
  await assert.rejects(
    android.share({ message: "x" }),
    /only action presented/u,
  );
  androidAdapter.result = { action: "presented", activityType: "injected" };
  await assert.rejects(
    android.share({ message: "x" }),
    /only action presented/u,
  );

  const iosAdapter = memoryAdapter("ios");
  const ios = createShareService(iosAdapter);
  iosAdapter.result = { action: "presented" };
  await assert.rejects(ios.share({ message: "x" }), /completed or dismissed/u);
  iosAdapter.result = { action: "dismissed", activityType: "injected" };
  await assert.rejects(ios.share({ message: "x" }), /must not contain/u);
  iosAdapter.result = {
    action: "completed",
    activityType: "x".repeat(SHARE_MAX_ACTIVITY_TYPE_LENGTH + 1),
  };
  await assert.rejects(ios.share({ message: "x" }), /1-512/u);
});

test("rejects overlapping sheets and recovers after every settlement", async () => {
  let settle;
  let rejectPresentation;
  const adapter = {
    platform: "android",
    showShareSheet() {
      return new Promise((resolve, reject) => {
        settle = resolve;
        rejectPresentation = reject;
      });
    },
  };
  const service = createShareService(adapter);
  const first = service.share({ message: "First" });
  await assert.rejects(
    service.share({ message: "Second" }),
    SharePresentationInProgressError,
  );
  settle({ action: "presented" });
  assert.deepEqual(await first, { action: "presented" });

  const second = service.share({ message: "Retry after success" });
  rejectPresentation(new Error("native presentation failed"));
  await assert.rejects(second, /native presentation failed/u);

  const third = service.share({ message: "Retry after failure" });
  settle({ action: "presented" });
  assert.deepEqual(await third, { action: "presented" });
});
