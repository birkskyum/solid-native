import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseNativeAndroidKeyguardShowing,
  preflightNativeAndroidRunDestination,
  restoreNativeAndroidRunDestination,
} from "../dist/index.js";

const passed = (stdout = "") => ({
  exitCode: 0,
  stdout,
  stderr: "",
  timedOut: false,
});

function commandKey(args) {
  return args.join(" ");
}

async function isolatedLeaseRoot(t) {
  const root = await mkdtemp(
    path.join(tmpdir(), "solid-native-android-run-lease-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function physicalRunner({
  authorizedDevices = ["PIXEL"],
  locked = false,
  originalStayAwake = "7",
  qemu = "",
  qemuBoot = qemu,
} = {}) {
  const calls = [];
  return {
    calls,
    async runCommand(command, args) {
      calls.push({ command, args });
      const key = commandKey(args);
      if (key === "devices -l") {
        return passed(
          `List of devices attached\n${authorizedDevices
            .map((serial) => `${serial} device product:fixture`)
            .join("\n")}\n`,
        );
      }
      if (key.endsWith("get-state")) return passed("device\n");
      if (key.endsWith("getprop ro.kernel.qemu")) return passed(`${qemu}\n`);
      if (key.endsWith("getprop ro.boot.qemu")) return passed(`${qemuBoot}\n`);
      if (key.endsWith("settings get global stay_on_while_plugged_in")) {
        return passed(`${originalStayAwake}\n`);
      }
      if (key.endsWith("dumpsys window policy")) {
        return passed(`KeyguardServiceDelegate\n  showing=${String(locked)}\n`);
      }
      return passed();
    },
  };
}

test("strictly parses Android keyguard state", () => {
  assert.equal(
    parseNativeAndroidKeyguardShowing("policy\n  showing=false\n"),
    false,
  );
  assert.equal(
    parseNativeAndroidKeyguardShowing(
      "policy\n  showing=false\nother\n  showing=true\n",
    ),
    true,
  );
  assert.throws(
    () => parseNativeAndroidKeyguardShowing("policy without state"),
    /recognizable keyguard state/u,
  );
});

test("leases and restores one unlocked physical Android run target", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  const fixture = physicalRunner();
  const result = await preflightNativeAndroidRunDestination({
    selector: { kind: "device", value: "PIXEL" },
    dependencies: { leaseRoot, runCommand: fixture.runCommand },
  });
  assert.equal(result.destination, "device");
  assert.equal(result.serial, "PIXEL");
  assert.equal(result.originalStayAwake, "7");
  assert.match(result.lease.token, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(
    fixture.calls.map(({ command, args }) => [command, ...args]),
    [
      ["adb", "-s", "PIXEL", "get-state"],
      ["adb", "-s", "PIXEL", "shell", "getprop", "ro.kernel.qemu"],
      ["adb", "-s", "PIXEL", "shell", "getprop", "ro.boot.qemu"],
      [
        "adb",
        "-s",
        "PIXEL",
        "shell",
        "settings",
        "get",
        "global",
        "stay_on_while_plugged_in",
      ],
      [
        "adb",
        "-s",
        "PIXEL",
        "shell",
        "settings",
        "put",
        "global",
        "stay_on_while_plugged_in",
        "3",
      ],
      ["adb", "-s", "PIXEL", "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
      ["adb", "-s", "PIXEL", "shell", "wm", "dismiss-keyguard"],
      ["adb", "-s", "PIXEL", "shell", "dumpsys", "window", "policy"],
    ],
  );

  await restoreNativeAndroidRunDestination({
    result,
    dependencies: { leaseRoot, runCommand: fixture.runCommand },
  });
  assert.deepEqual(fixture.calls.at(-1).args, [
    "-s",
    "PIXEL",
    "shell",
    "settings",
    "put",
    "global",
    "stay_on_while_plugged_in",
    "7",
  ]);
});

test("restores an absent setting by deleting the temporary lease", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  const fixture = physicalRunner({ originalStayAwake: "null", qemu: "0" });
  const result = await preflightNativeAndroidRunDestination({
    selector: { kind: "deviceId", value: "PIXEL" },
    dependencies: { leaseRoot, runCommand: fixture.runCommand },
  });
  await restoreNativeAndroidRunDestination({
    result,
    dependencies: { leaseRoot, runCommand: fixture.runCommand },
  });
  assert.deepEqual(fixture.calls.at(-1).args, [
    "-s",
    "PIXEL",
    "shell",
    "settings",
    "delete",
    "global",
    "stay_on_while_plugged_in",
  ]);
});

test("restores the lease before rejecting a secure keyguard", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  const fixture = physicalRunner({ locked: true });
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: { leaseRoot, runCommand: fixture.runCommand },
    }),
    /Android device PIXEL is locked[\s\S]*keeps an unlocked USB device awake/u,
  );
  assert.deepEqual(fixture.calls.at(-1).args.slice(-4), [
    "put",
    "global",
    "stay_on_while_plugged_in",
    "7",
  ]);
});

test("validates an emulator without changing device power state", async () => {
  const calls = [];
  const result = await preflightNativeAndroidRunDestination({
    selector: { kind: "device", value: "emulator-5554" },
    dependencies: {
      async runCommand(command, args) {
        calls.push({ command, args });
        return commandKey(args).endsWith("get-state")
          ? passed("device\n")
          : passed("1\n");
      },
    },
  });
  assert.deepEqual(result, {
    destination: "emulator",
    serial: "emulator-5554",
  });
  await restoreNativeAndroidRunDestination({
    result,
    dependencies: {
      async runCommand() {
        throw new Error("emulator restoration should be a no-op");
      },
    },
  });
  assert.equal(calls.length, 3);
});

test("resolves exactly one automatic Android run target", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  const fixture = physicalRunner();
  const result = await preflightNativeAndroidRunDestination({
    selector: { kind: "automatic" },
    dependencies: { leaseRoot, runCommand: fixture.runCommand },
  });
  assert.equal(result.destination, "device");
  assert.equal(result.serial, "PIXEL");
  assert.deepEqual(fixture.calls[0], {
    command: "adb",
    args: ["devices", "-l"],
  });
  await restoreNativeAndroidRunDestination({
    result,
    dependencies: { leaseRoot, runCommand: fixture.runCommand },
  });

  for (const authorizedDevices of [[], ["PIXEL", "emulator-5554"]]) {
    const ambiguous = physicalRunner({ authorizedDevices });
    await assert.rejects(
      preflightNativeAndroidRunDestination({
        selector: { kind: "automatic" },
        dependencies: { leaseRoot, runCommand: ambiguous.runCommand },
      }),
      authorizedDevices.length === 0
        ? /No authorized Android device or emulator/u
        : /Found 2 authorized Android targets/u,
    );
    assert.equal(ambiguous.calls.length, 1);
  }
});

test("compensates after a failed stay-awake mutation attempt", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  const fixture = physicalRunner();
  const baseRunner = fixture.runCommand;
  fixture.runCommand = async (command, args) => {
    if (
      commandKey(args).endsWith(
        "settings put global stay_on_while_plugged_in 3",
      )
    ) {
      fixture.calls.push({ command, args });
      return {
        exitCode: 1,
        stdout: "",
        stderr: "remote failure after write",
        timedOut: false,
      };
    }
    return baseRunner(command, args);
  };
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: { leaseRoot, runCommand: fixture.runCommand },
    }),
    /stay-awake lease failed: remote failure after write/u,
  );
  assert.deepEqual(fixture.calls.at(-1).args.slice(-4), [
    "put",
    "global",
    "stay_on_while_plugged_in",
    "7",
  ]);
});

test("fails closed on unavailable adb and malformed platform state", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: {
        async runCommand() {
          return {
            exitCode: null,
            stdout: "",
            stderr: "spawn adb ENOENT",
            timedOut: false,
            errorCode: "ENOENT",
          };
        },
      },
    }),
    /Could not start adb/u,
  );

  const fixture = physicalRunner({ originalStayAwake: "surprising" });
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: { leaseRoot, runCommand: fixture.runCommand },
    }),
    /invalid stay-awake setting/u,
  );

  const malformedIdentity = physicalRunner({ qemuBoot: "surprising" });
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: { runCommand: malformedIdentity.runCommand },
    }),
    /invalid emulator identity/u,
  );
});

test("serializes one device and recovers a dead owner's prepared lease", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  const fixture = physicalRunner();
  const dependencies = {
    leaseRoot,
    runCommand: fixture.runCommand,
    isProcessAlive(processId) {
      return processId === process.pid;
    },
  };
  const first = await preflightNativeAndroidRunDestination({
    selector: { kind: "device", value: "PIXEL" },
    dependencies,
  });
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies,
    }),
    new RegExp(`already owned by Solid Native process ${String(process.pid)}`),
  );

  const [leaseDirectory] = await readdir(leaseRoot);
  assert.ok(leaseDirectory !== undefined);
  const ownerPath = path.join(leaseRoot, leaseDirectory, "owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeFile(
    ownerPath,
    `${JSON.stringify({ ...owner, processId: 2_147_483_647 })}\n`,
  );

  const recovered = await preflightNativeAndroidRunDestination({
    selector: { kind: "device", value: "PIXEL" },
    dependencies,
  });
  assert.notEqual(recovered.lease.token, first.lease.token);
  const restoreCommands = fixture.calls.filter(({ args }) =>
    commandKey(args).endsWith("settings put global stay_on_while_plugged_in 7"),
  );
  assert.equal(restoreCommands.length, 1);
  await restoreNativeAndroidRunDestination({
    result: recovered,
    dependencies,
  });
});

test("fails closed on corrupt prepared ownership metadata", async (t) => {
  const leaseRoot = await isolatedLeaseRoot(t);
  const fixture = physicalRunner();
  await preflightNativeAndroidRunDestination({
    selector: { kind: "device", value: "PIXEL" },
    dependencies: { leaseRoot, runCommand: fixture.runCommand },
  });
  const [leaseDirectory] = await readdir(leaseRoot);
  assert.ok(leaseDirectory !== undefined);
  await writeFile(path.join(leaseRoot, leaseDirectory, "owner.json"), "{}\n");

  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: {
        leaseRoot,
        runCommand: fixture.runCommand,
        nowMilliseconds: () => Date.now() + 31_000,
      },
    }),
    /restoration metadata but no valid owner/u,
  );
});

test("rejects linked or permission-weakened Android lease state", async (t) => {
  if (process.platform === "win32") return;
  const fixture = physicalRunner();

  const linkedRoot = await isolatedLeaseRoot(t);
  const outside = await mkdtemp(
    path.join(tmpdir(), "solid-native-android-run-lease-outside-"),
  );
  t.after(() => rm(outside, { recursive: true, force: true }));
  const identity = createHash("sha256").update("PIXEL").digest("hex");
  await symlink(outside, path.join(linkedRoot, identity));
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: { leaseRoot: linkedRoot, runCommand: fixture.runCommand },
    }),
    /ownership must be a real directory/u,
  );
  assert.equal(
    fixture.calls.some(({ args }) =>
      commandKey(args).includes("stay_on_while_plugged_in"),
    ),
    false,
  );

  const publicRoot = await isolatedLeaseRoot(t);
  await chmod(publicRoot, 0o755);
  await assert.rejects(
    preflightNativeAndroidRunDestination({
      selector: { kind: "device", value: "PIXEL" },
      dependencies: { leaseRoot: publicRoot, runCommand: fixture.runCommand },
    }),
    /lease root must be private/u,
  );
});
