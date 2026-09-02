import assert from "node:assert/strict";
import test from "node:test";

import { assertNotificationsBundle } from "./verify-notifications-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/notifications.tsx",
  "/workspace/apps/native-e2e/adapters/NotifeeApiModule.ts",
  "/workspace/apps/native-e2e/generated/SolidNativeBindings.ts",
  "/workspace/packages/notifications/dist/index.js",
  "/workspace/packages/notifications/dist/notify-kit-10.js",
  "/workspace/packages/notifications/dist/solid.js",
];

test("accepts one complete wrapper-free notification seam", () => {
  assert.deepEqual(
    assertNotificationsBundle({
      sources: [...requiredSources, "/workspace/other.js"],
    }),
    requiredSources,
  );
});

test("rejects missing, duplicate, unexpected, and vendor-facade sources", () => {
  assert.throws(
    () => assertNotificationsBundle({ sources: requiredSources.slice(1) }),
    /exactly one notification proof source/u,
  );
  assert.throws(
    () =>
      assertNotificationsBundle({
        sources: [...requiredSources, requiredSources[2]],
      }),
    /exactly one notification proof source/u,
  );
  assert.throws(
    () =>
      assertNotificationsBundle({
        sections: [
          {
            map: {
              sources: [
                ...requiredSources,
                "/workspace/packages/notifications/src/private.js",
              ],
            },
          },
        ],
      }),
    /unexpected package sources/u,
  );
  assert.throws(
    () =>
      assertNotificationsBundle({
        sources: [
          ...requiredSources,
          "/workspace/node_modules/react-native-notify-kit/dist/index.js",
        ],
      }),
    /Notify Kit JavaScript facades/u,
  );
});
