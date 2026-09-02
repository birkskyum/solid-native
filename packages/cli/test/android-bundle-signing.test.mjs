import assert from "node:assert/strict";
import { lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultNativeAndroidBundleSigningCommandRunner,
  formatNativeAndroidBundleSigningReport,
  parseNativeAndroidBundleSigners,
  verifyNativeAndroidBundleSigning,
} from "../dist/index.js";

const RELEASE_SHA256 = "ab".repeat(32);
const OTHER_SHA256 = "cd".repeat(32);

function keytoolReport({ debug = false, sha256 = RELEASE_SHA256 } = {}) {
  const fingerprint = sha256.match(/.{2}/gu).join(":").toUpperCase();
  const subject = debug
    ? "C=US, O=Android, CN=Android Debug"
    : "CN=Example Upload, O=Example, C=CH";
  return `Signer #1:

Certificate #1:
Owner: ${subject}
Issuer: ${subject}
Serial number: 1
Certificate fingerprints:
         SHA256: ${fingerprint}
Signature algorithm name: SHA256withRSA
`;
}

function commandResult(stdout, exitCode = 0) {
  return {
    exitCode,
    stdout,
    stderr: "",
    timedOut: false,
    outputTruncated: false,
  };
}

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-android-signing-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "app-release.aab");
  await writeFile(artifactPath, "signed application bundle");
  return { artifactPath, directory };
}

function signingRunner(
  keytoolOutput,
  jarsignerOutput = "jar verified.\n",
  jarsignerExitCode = 0,
) {
  return async (command, args, context) => {
    assert.equal(context.timeoutMs, 30_000);
    assert.equal(context.env.LC_ALL, "C");
    assert.match(args.at(-1), /app-release\.aab$/u);
    if (path.basename(command).startsWith("keytool")) {
      return commandResult(keytoolOutput);
    }
    assert.ok(args.includes("-strict"));
    return commandResult(jarsignerOutput, jarsignerExitCode);
  };
}

test("parses only bounded keytool leaf signing certificates", () => {
  assert.deepEqual(parseNativeAndroidBundleSigners(keytoolReport()), [
    { certificateSha256: RELEASE_SHA256, debug: false },
  ]);
  assert.deepEqual(
    parseNativeAndroidBundleSigners(keytoolReport({ debug: true })),
    [{ certificateSha256: RELEASE_SHA256, debug: true }],
  );
  assert.deepEqual(
    parseNativeAndroidBundleSigners("Not a signed jar file\n"),
    [],
  );
  assert.throws(
    () => parseNativeAndroidBundleSigners("Signer #1:\nCertificate #1:\n"),
    /unrecognized signer certificate report/u,
  );
});

test("verifies one non-debug AAB signer and pins its certificate", async (t) => {
  const { artifactPath, directory } = await fixture(t);
  const inspectedPaths = [];
  const runner = signingRunner(keytoolReport());
  const report = await verifyNativeAndroidBundleSigning({
    artifactPath,
    cwd: directory,
    expectedCertificateSha256: RELEASE_SHA256.toUpperCase(),
    env: {},
    dependencies: {
      async runCommand(...args) {
        inspectedPaths.push(args[1].at(-1));
        return runner(...args);
      },
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.artifact.name, "app-release.aab");
  assert.equal(report.artifact.bytes, 25);
  assert.match(report.artifact.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(report.signers, [
    { certificateSha256: RELEASE_SHA256, debug: false },
  ]);
  assert.deepEqual(
    report.checks.map((entry) => [entry.id, entry.status]),
    [
      ["signature-integrity", "pass"],
      ["signer-certificate", "pass"],
      ["debug-certificate", "pass"],
      ["expected-certificate", "pass"],
    ],
  );
  assert.match(formatNativeAndroidBundleSigningReport(report), /Ready:/u);
  assert.match(
    formatNativeAndroidBundleSigningReport(report),
    new RegExp(`Signer: sha256:${RELEASE_SHA256}`, "u"),
  );
  assert.equal(inspectedPaths.length, 2);
  assert.ok(inspectedPaths.every((entry) => entry !== artifactPath));
  assert.equal(
    await lstat(path.dirname(inspectedPaths[0])).catch(() => undefined),
    undefined,
  );
});

test("rejects debug, unsigned, and unexpected Android bundle signers", async (t) => {
  const { artifactPath, directory } = await fixture(t);
  const debug = await verifyNativeAndroidBundleSigning({
    artifactPath,
    cwd: directory,
    dependencies: {
      runCommand: signingRunner(keytoolReport({ debug: true })),
    },
  });
  assert.equal(debug.ok, false);
  assert.equal(
    debug.checks.find((entry) => entry.id === "debug-certificate")?.status,
    "fail",
  );
  assert.match(formatNativeAndroidBundleSigningReport(debug), /Not ready/u);

  const unsigned = await verifyNativeAndroidBundleSigning({
    artifactPath,
    cwd: directory,
    dependencies: {
      runCommand: signingRunner(
        "Not a signed jar file\n",
        "jar is unsigned.\n",
      ),
    },
  });
  assert.equal(unsigned.ok, false);
  assert.deepEqual(unsigned.signers, []);
  assert.equal(
    unsigned.checks.find((entry) => entry.id === "signature-integrity")?.status,
    "fail",
  );

  const unexpected = await verifyNativeAndroidBundleSigning({
    artifactPath,
    cwd: directory,
    expectedCertificateSha256: OTHER_SHA256,
    dependencies: { runCommand: signingRunner(keytoolReport()) },
  });
  assert.equal(unexpected.ok, false);
  assert.equal(
    unexpected.checks.find((entry) => entry.id === "expected-certificate")
      ?.status,
    "fail",
  );

  const partiallyUnsigned = await verifyNativeAndroidBundleSigning({
    artifactPath,
    cwd: directory,
    dependencies: {
      runCommand: signingRunner(
        keytoolReport(),
        "jar verified, with signer errors.\n\nError:\nThis jar contains unsigned entries which haven't been integrity-checked.\n",
        16,
      ),
    },
  });
  assert.equal(partiallyUnsigned.ok, false);
  assert.equal(
    partiallyUnsigned.checks.find((entry) => entry.id === "signature-integrity")
      ?.status,
    "fail",
  );
});

test("accepts only expected strict self-signed upload-certificate errors", async (t) => {
  const { artifactPath, directory } = await fixture(t);
  const report = await verifyNativeAndroidBundleSigning({
    artifactPath,
    cwd: directory,
    dependencies: {
      runCommand: signingRunner(
        keytoolReport(),
        "jar verified, with signer errors.\n\nError:\nThis jar contains entries whose certificate chain is invalid. Reason: upload certificate is not a public trust anchor\nThis jar contains entries whose signer certificate is self-signed.\n\nWarning:\nThis jar contains signatures that do not include a timestamp.\n",
        4,
      ),
    },
  });
  assert.equal(report.ok, true);

  const expired = await verifyNativeAndroidBundleSigning({
    artifactPath,
    cwd: directory,
    dependencies: {
      runCommand: signingRunner(
        keytoolReport(),
        "jar verified, with signer errors.\n\nError:\nThis jar contains entries whose certificate chain is invalid. Reason: upload certificate is not a public trust anchor\nThis jar contains entries whose signer certificate has expired.\n",
        4,
      ),
    },
  });
  assert.equal(expired.ok, false);
});

test("fails closed on invalid input, missing JDK tools, and artifact races", async (t) => {
  const { artifactPath, directory } = await fixture(t);
  await assert.rejects(
    verifyNativeAndroidBundleSigning({
      artifactPath: path.join(directory, "app-release.apk"),
    }),
    /requires an \.aab file/u,
  );
  if (process.platform !== "win32") {
    const linkedArtifactPath = path.join(directory, "linked-release.aab");
    await symlink(artifactPath, linkedArtifactPath);
    await assert.rejects(
      verifyNativeAndroidBundleSigning({
        artifactPath: linkedArtifactPath,
      }),
      /readable non-linked regular file/u,
    );
  }
  await assert.rejects(
    verifyNativeAndroidBundleSigning({
      artifactPath,
      expectedCertificateSha256: "not-a-fingerprint",
    }),
    /64 hexadecimal digits/u,
  );
  await assert.rejects(
    verifyNativeAndroidBundleSigning({
      artifactPath,
      dependencies: {
        async runCommand() {
          return {
            exitCode: null,
            stdout: "",
            stderr: "",
            timedOut: false,
            outputTruncated: false,
            errorCode: "ENOENT",
          };
        },
      },
    }),
    /Install JDK 17\+/u,
  );
  await assert.rejects(
    verifyNativeAndroidBundleSigning({
      artifactPath,
      dependencies: {
        async runCommand() {
          return { ...commandResult(""), timedOut: true };
        },
      },
    }),
    /timed out while inspecting/u,
  );
  await assert.rejects(
    verifyNativeAndroidBundleSigning({
      artifactPath,
      dependencies: {
        async runCommand() {
          return { ...commandResult(""), outputTruncated: true };
        },
      },
    }),
    /output exceeded 262144 bytes/u,
  );
  let changed = false;
  await assert.rejects(
    verifyNativeAndroidBundleSigning({
      artifactPath,
      dependencies: {
        async runCommand(command) {
          if (!changed && path.basename(command).startsWith("jarsigner")) {
            changed = true;
            await writeFile(artifactPath, "changed application bundle");
          }
          return path.basename(command).startsWith("keytool")
            ? commandResult(keytoolReport())
            : commandResult("jar verified.\n");
        },
      },
    }),
    /changed while its signing identity was inspected/u,
  );
});

test("bounds JDK subprocess time and retained output", async () => {
  const startedAt = Date.now();
  const timedOut = await defaultNativeAndroidBundleSigningCommandRunner(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { cwd: process.cwd(), env: process.env, timeoutMs: 25 },
  );
  assert.equal(timedOut.timedOut, true);
  assert.ok(Date.now() - startedAt < 5_000);

  const oversized = await defaultNativeAndroidBundleSigningCommandRunner(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(300000))"],
    { cwd: process.cwd(), env: process.env, timeoutMs: 5_000 },
  );
  assert.equal(oversized.exitCode, 0);
  assert.equal(oversized.outputTruncated, true);
  assert.equal(Buffer.byteLength(oversized.stdout), 256 * 1024);
});
