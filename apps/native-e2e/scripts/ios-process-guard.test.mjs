import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

async function runGuardCleanup(cleanupExitCode) {
  const guardPath = path.join(scriptDirectory, "ios-process-guard.sh");
  const { stdout, stderr } = await execFileAsync("/bin/sh", [
    "-c",
    `
. "$1"
cleanup_status=$2
node() { return "$cleanup_status"; }
APP_DIR=/unused
SOLID_NATIVE_IOS_DESTINATION=device-id
sleep 30 &
SOLID_NATIVE_IOS_PROCESS_GUARD_PID=$!
stop_solid_native_ios_process_guard
if kill -0 "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID" >/dev/null 2>&1; then
  process_state=alive
  kill "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID"
  wait "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID" 2>/dev/null || true
else
  process_state=dead
fi
if [ -n "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID" ]; then
  ownership_state=retained
else
  ownership_state=cleared
fi
printf '%s:%s\n' "$process_state" "$ownership_state"
`,
    "ios-process-guard-test",
    guardPath,
    String(cleanupExitCode),
  ]);
  return { stderr, stdout: stdout.trim() };
}

test("releases the watchdog only after foreground device cleanup succeeds", async () => {
  assert.deepEqual(await runGuardCleanup(0), {
    stderr: "",
    stdout: "dead:cleared",
  });

  const failed = await runGuardCleanup(1);
  assert.equal(failed.stdout, "alive:retained");
  assert.match(failed.stderr, /watchdog will retry/iu);
});

test("guards every bounded physical iOS runner against abrupt orphaning", async () => {
  const guard = await readFile(
    path.join(scriptDirectory, "ios-process-guard.sh"),
    "utf8",
  );
  assert.match(guard, /--spawn-watchdog "\$\$" "\$timeout_milliseconds"/u);
  assert.match(guard, /TIMEOUT_SECONDS:-1200/u);
  assert.match(guard, /cannot exceed 3600/u);
  assert.match(
    guard,
    /if ! node "\$APP_DIR\/scripts\/ios-stop-processes\.mjs"/u,
  );
  assert.match(guard, /watchdog will retry after this runner exits/iu);
  const killIndex = guard.indexOf('kill "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID"');
  const cleanupIndex = guard.indexOf(
    'node "$APP_DIR/scripts/ios-stop-processes.mjs"',
  );
  assert.ok(cleanupIndex >= 0);
  assert.ok(killIndex > cleanupIndex);

  const scripts = await readdir(scriptDirectory);
  const physicalRunners = [];
  for (const script of scripts.filter((entry) => entry.endsWith(".sh"))) {
    const source = await readFile(path.join(scriptDirectory, script), "utf8");
    if (source.includes('scripts/ios-process-guard.sh"')) {
      physicalRunners.push({ script, source });
    }
  }
  assert.ok(physicalRunners.length > 0);

  for (const { script: runner, source } of physicalRunners) {
    assert.match(
      source,
      /\. "\$APP_DIR\/scripts\/ios-process-guard\.sh"/u,
      runner,
    );
    assert.match(source, /start_solid_native_ios_process_guard/u, runner);
    assert.match(source, /stop_solid_native_ios_process_guard/u, runner);
    assert.match(source, /trap cleanup EXIT/u, runner);
    assert.match(source, /trap 'exit 143' TERM/u, runner);
    assert.doesNotMatch(
      source,
      /stop_solid_native_ios_process_guard\s*\n\s*node "\$APP_DIR\/scripts\/ios-stop-processes\.mjs"/u,
      runner,
    );
  }
});

test("does not bind interactive iOS launches to the parent watchdog", async () => {
  for (const launcher of ["ios-control.sh", "ios-release.sh"]) {
    const source = await readFile(path.join(scriptDirectory, launcher), "utf8");
    assert.doesNotMatch(source, /ios-process-guard/u, launcher);
  }
});

test("bounds every interactive iOS launch with an exact-process lease", async () => {
  const lease = await readFile(
    path.join(scriptDirectory, "ios-process-lease.sh"),
    "utf8",
  );
  assert.match(lease, /--spawn-lease "\$timeout_milliseconds"/u);
  assert.match(lease, /LAUNCH_LEASE_SECONDS:-1200/u);
  assert.match(lease, /cannot exceed 3600/u);
  assert.match(lease, /the app was stopped/iu);

  for (const launcher of ["ios-control.sh", "ios-release.sh"]) {
    const source = await readFile(path.join(scriptDirectory, launcher), "utf8");
    assert.match(
      source,
      /\. "\$APP_DIR\/scripts\/ios-process-lease\.sh"/u,
      launcher,
    );
    const launchIndex = source.indexOf("device process launch");
    const leaseIndex = source.indexOf("start_solid_native_ios_process_lease");
    assert.ok(launchIndex >= 0, launcher);
    assert.ok(leaseIndex > launchIndex, launcher);
  }
});
