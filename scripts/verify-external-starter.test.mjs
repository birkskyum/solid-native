import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createIOSNativeBuildArguments,
  formatStarterVerificationError,
  parseArguments,
} from "./verify-external-starter.mjs";
import { createIOSStarterGateBundleIdentifier } from "./verify-ios-starter-device.mjs";

test("preserves hardware and cleanup causes in aggregate failures", () => {
  const failure = new AggregateError(
    [new Error("process inventory changed"), new Error("cleanup timed out")],
    "The hardware gate and cleanup failed.",
  );
  assert.equal(
    formatStarterVerificationError(failure),
    "The hardware gate and cleanup failed.\n- process inventory changed\n- cleanup timed out",
  );
});

test("bounds recursive aggregate error details", () => {
  const failure = new AggregateError([], "recursive cleanup failure");
  failure.errors.push(failure);
  assert.equal(
    formatStarterVerificationError(failure),
    "recursive cleanup failure\n- recursive cleanup failure\n  - [circular aggregate error]",
  );
});

test("requires explicit, paired physical-device options", () => {
  assert.throws(
    () =>
      parseArguments(["--platform", "ios", "--ios-device", "DEVICE"], "darwin"),
    /--ios-device and --ios-team must be supplied together/u,
  );
  assert.throws(
    () =>
      parseArguments(
        ["--platform", "android", "--ios-team", "69458QJ6BS"],
        "darwin",
      ),
    /must be supplied together/u,
  );
  assert.throws(
    () =>
      parseArguments(
        [
          "--platform",
          "android",
          "--ios-device",
          "DEVICE",
          "--ios-team",
          "69458QJ6BS",
        ],
        "darwin",
      ),
    /requires the ios or all platform selection/u,
  );
  assert.throws(
    () => parseArguments(["--platform", "ios"], "linux"),
    /requires macOS/u,
  );
});

test("physical iOS selection implies a native Release build", () => {
  assert.equal(
    createIOSStarterGateBundleIdentifier(),
    "dev.solidnative.packedstarter.iosgate",
  );
  assert.deepEqual(
    parseArguments(
      [
        "--platform",
        "ios",
        "--ios-device",
        "CORE-DEVICE-ID",
        "--ios-team",
        "69458QJ6BS",
      ],
      "darwin",
    ),
    {
      androidDevice: undefined,
      help: false,
      iosDevice: "CORE-DEVICE-ID",
      iosTeam: "69458QJ6BS",
      keep: false,
      nativeBuild: true,
      output: undefined,
      platform: "ios",
    },
  );
});

test("separates unsigned generic and signed physical Xcode builds", () => {
  const applicationRoot = path.resolve("/external/packed-starter");
  const generic = createIOSNativeBuildArguments(applicationRoot, {});
  assert.ok(generic.includes("generic/platform=iOS"));
  assert.ok(generic.includes("CODE_SIGNING_ALLOWED=NO"));
  assert.equal(
    generic.some((argument) => argument.startsWith("DEVELOPMENT_TEAM=")),
    false,
  );

  const physical = createIOSNativeBuildArguments(applicationRoot, {
    iosDestination: "00008150-001155E01191401C",
    iosDevice: "CORE-DEVICE-ID",
    iosTeam: "69458QJ6BS",
  });
  assert.ok(physical.includes("id=00008150-001155E01191401C"));
  assert.ok(physical.includes("DEVELOPMENT_TEAM=69458QJ6BS"));
  assert.ok(physical.includes("CODE_SIGN_STYLE=Automatic"));
  assert.ok(physical.includes("-allowProvisioningUpdates"));
  assert.equal(physical.includes("CODE_SIGNING_ALLOWED=NO"), false);
  assert.equal(physical.at(-1), "build");
});
