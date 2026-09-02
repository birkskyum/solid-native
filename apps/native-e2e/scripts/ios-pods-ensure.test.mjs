import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const scripts = new URL("./", import.meta.url);
const optimizedRunners = [
  "ios-test.sh",
  "ios-tabs-test.sh",
  "ios-list-test.sh",
  "ios-initial-list-test.sh",
  "ios-measured-list-test.sh",
  "ios-worklet-test.sh",
  "ios-keyboard-test.sh",
  "ios-navigation-restoration-test.sh",
  "ios-navigation-modal-test.sh",
  "ios-navigation-sheet-test.sh",
  "ios-networking-test.sh",
];

async function createPodFixture() {
  const directory = await mkdtemp(join(tmpdir(), "solid-native-pods-ensure-"));
  const repository = join(directory, "repository");
  const application = join(repository, "apps", "native-e2e");
  const ios = join(application, "ios");
  const bin = join(directory, "bin");
  await mkdir(join(ios, "Pods"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(ios, "Podfile"), "platform :ios, '15.1'\n");
  await writeFile(
    join(repository, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n",
  );
  await writeFile(join(application, "package.json"), '{"name":"fixture"}\n');

  const podfileChecksum = spawnSync("shasum", [join(ios, "Podfile")], {
    encoding: "utf8",
  }).stdout.split(/\s/u, 1)[0];
  await writeFile(
    join(ios, "Podfile.lock"),
    `PODFILE CHECKSUM: ${podfileChecksum}\n`,
  );

  const pod = join(bin, "pod");
  await writeFile(
    pod,
    `#!/bin/sh
set -eu
[ "\${1-}" = install ]
mkdir -p Pods/Pods.xcodeproj
: >Pods/Pods.xcodeproj/project.pbxproj
cp Podfile.lock Pods/Manifest.lock
count=0
if [ -f "\${SOLID_NATIVE_POD_CALLS}" ]; then count=$(cat "\${SOLID_NATIVE_POD_CALLS}"); fi
printf '%s\\n' "$((count + 1))" >"\${SOLID_NATIVE_POD_CALLS}"
`,
  );
  await chmod(pod, 0o755);

  return { application, bin, directory, ios, repository };
}

function runEnsure(fixture, calls) {
  return spawnSync(
    "sh",
    [
      "-c",
      '. "$SOLID_NATIVE_PODS_HELPER"; ensure_solid_native_ios_pods; ensure_solid_native_ios_pods',
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        APP_DIR: fixture.application,
        IOS_DIR: fixture.ios,
        PATH: `${fixture.bin}${delimiter}${process.env.PATH ?? ""}`,
        REPO_ROOT: fixture.repository,
        SOLID_NATIVE_POD_CALLS: calls,
        SOLID_NATIVE_PODS_HELPER: new URL("ios-pods-ensure.sh", scripts)
          .pathname,
      },
    },
  );
}

test("invalidates the cached iOS pod graph when workspace inputs change", async () => {
  const helper = await readFile(new URL("ios-pods-ensure.sh", scripts), "utf8");
  assert.match(
    helper,
    /shasum[\s\S]*Podfile[\s\S]*pnpm-lock\.yaml[\s\S]*package\.json/u,
  );
  assert.match(helper, /\.solid-native-input-fingerprint/u);
  assert.match(
    helper,
    /cmp -s "\$IOS_DIR\/Podfile\.lock" "\$IOS_DIR\/Pods\/Manifest\.lock"/u,
  );
  const install = helper.indexOf("pod install");
  const recordFingerprint = helper.indexOf(
    `printf '%s\\n' "$input_fingerprint"`,
  );
  assert.ok(install >= 0 && install < recordFingerprint);

  for (const runnerName of optimizedRunners) {
    const runner = await readFile(new URL(runnerName, scripts), "utf8");
    assert.match(runner, /scripts\/ios-pods-ensure\.sh/u, runnerName);
    assert.match(runner, /ensure_solid_native_ios_pods/u, runnerName);
    assert.doesNotMatch(runner, /PODFILE_CHECKSUM/u, runnerName);
  }
});

test("reuses a complete pod graph and invalidates changed workspace inputs", async (t) => {
  const fixture = await createPodFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const calls = join(fixture.directory, "pod-calls");

  const first = runEnsure(fixture, calls);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(await readFile(calls, "utf8"), "1\n");
  assert.match(
    first.stdout,
    /Using the CocoaPods graph matching Podfile\.lock and workspace dependency inputs\./u,
  );

  await writeFile(
    join(fixture.application, "package.json"),
    '{"name":"fixture","version":"0.0.1"}\n',
  );
  const changed = runEnsure(fixture, calls);
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(await readFile(calls, "utf8"), "2\n");
});
