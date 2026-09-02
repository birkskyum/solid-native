import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fails unless foreground notification delivery preserves its private platform cause", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /createNotificationEvent\(notificationService,[\s\S]*event\?\.notificationId !== NOTIFICATION_PROOF_ID[\s\S]*setNotificationStatus\(NOTIFICATION_DELIVERED_TEXT\)/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{NOTIFICATION_COMPUTATION_NAME\}>[\s\S]*solid-native-notification-status/u,
  );
  assert.match(
    source,
    /verifyPlatformEventCausality\([\s\S]*"platform\.notification\.delivered"[\s\S]*NOTIFICATION_COMPUTATION_NAME[\s\S]*NOTIFICATION_PROOF_ID[\s\S]*SOLID_NATIVE_NOTIFICATION_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /event\.kind === "pressed"[\s\S]*event\.actionId === "default"[\s\S]*verifyPlatformEventCausality\([\s\S]*"platform\.notification\.pressed"[\s\S]*"discrete"[\s\S]*"user-blocking"[\s\S]*SOLID_NATIVE_NOTIFICATION_PRESS_CAUSALITY_SUCCEEDED/u,
  );
  assert.doesNotMatch(source, /notificationSubscription/u);
});

test("pins the wrapper-free Notify Kit body action explicitly", async () => {
  const source = await readFile(
    new URL(
      "../../../packages/notifications/src/notify-kit-10.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /pressAction: Object\.freeze\(\{[\s\S]*id: "default",[\s\S]*launchActivity: "default"/u,
  );
});
