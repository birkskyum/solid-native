import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatNativeAndroidApkSigningReport,
  parseNativeAndroidApkSigners,
  resolveNativeAndroidApkSignerCommand,
  verifyNativeAndroidApkSigning,
} from "../dist/index.js";

const RELEASE_SHA256 =
  "f856811198c537b8762c9f3896f3ba3f9b3f165c89808748afed9eb12cf62e63";
const ROTATED_SHA256 =
  "2f3b10ee3c0d8a1a2e68f3f8bb5a3ecf0ffa2d2ee9da8fd3869222bd8ebfb106";
const DEBUG_SHA256 =
  "6d56e408b1eaf7426af75281e8e9caa8ff4cb5df475348c3fd5a450e130a6d0b";

const RELEASE_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIUFqeYOAlmIK+jR5QLXPdQo0IVy9kwDQYJKoZIhvcNAQEL
BQAwPjELMAkGA1UEBhMCQ0gxFTATBgNVBAoMDFNvbGlkIE5hdGl2ZTEYMBYGA1UE
AwwPUmVsZWFzZSBGaXh0dXJlMB4XDTI2MDgyNzAyMTUyNFoXDTM2MDgyNDAyMTUy
NFowPjELMAkGA1UEBhMCQ0gxFTATBgNVBAoMDFNvbGlkIE5hdGl2ZTEYMBYGA1UE
AwwPUmVsZWFzZSBGaXh0dXJlMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEAtCpffJWFxULPowY6mbSjt5771RkCFq3KTZPq3pxEhkRbENrzMpYCWf7Y4Vdz
uaibxjHz/iwhlB54EfmKuCyopeGRKJkWG3xScITA/Noj/J3Kyu71bg5ohrJ82Bum
WUzO9s8V/kKo5KfBOA2IptSxlPx7z1TkxhpQuEW51KtqrfEbN1z87pwBMKZ+lvK8
Vhjboo/tQ58aQ7J+DvjAr+e1HMFO2sIWLNdenBGRBmrrcOIEfPBjCYYy5ozFrNZb
acMkf3Vg0H2FBP/8zcEeM8uWX+2Ot/xWkGyo0Qsc5DIY0dVFiAbTbNz912Gvqbrz
sSJessEfFe7S75voeLeM3BmO+wIDAQABo1MwUTAdBgNVHQ4EFgQUtQfUtI6W4Qb+
3XQUaURB+wSGvIcwHwYDVR0jBBgwFoAUtQfUtI6W4Qb+3XQUaURB+wSGvIcwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAHE/cwha0veY9hhlPuEg3
JMY5YpTs1YfgOWMCXVsMfctA7Qz7nTpdD3BYwunhBpyBUUSk3wtfbb0x5u+P04MB
GPx/3g+8Ou4JzaTdrtuuvgY5kkawo1u8Wl/9aJCLAHc/hD8v3SPNYZiATOjjnhVS
+q8CZILMJFIpdnKFcxINw3rZo0yyOKLZa2NrOhHWvbA7pGECHgYT4ueVPbH100jd
8UD4vVmH6qyW7R90wFnk2PRAPAJSs8IWvnfT9Lrx1LUfDFRLCouoOm7GNs5LhWzy
SWHnGousCS0hdnqRjqS76/QI8rfyN8s9XG1TUx0bkDaYiFpHoKV1dpWQtIb+yzRG
qA==
-----END CERTIFICATE-----`;

const ROTATED_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIUO+RAY9bmL41xI5evPlVdtR71UEowDQYJKoZIhvcNAQEL
BQAwPjELMAkGA1UEBhMCQ0gxFTATBgNVBAoMDFNvbGlkIE5hdGl2ZTEYMBYGA1UE
AwwPUm90YXRlZCBGaXh0dXJlMB4XDTI2MDgyNzAyMTUyOVoXDTM2MDgyNDAyMTUy
OVowPjELMAkGA1UEBhMCQ0gxFTATBgNVBAoMDFNvbGlkIE5hdGl2ZTEYMBYGA1UE
AwwPUm90YXRlZCBGaXh0dXJlMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEApWc9lks4kT6uio8rkSZo0Pxyaz85ZgMZjCNSGm80jiW2tf0K8WZWgNiFDLXT
zbu5mIx0DslU0uN4mL35x5W1qVxfBhMoiadHBFGpTfDNsKmEej1GjrIZ6YNHRSUE
3iAYwNSv+xkGV7nvvQoKaTnpSJVP2g7MI37FdXiWRQFMDXOQbmw2K75jMfLRGAW/
OPNjS83nN6/9RyNeNWprtekcobOoSSiLxt+rR57Sc/ktWP7+O8WOipkAO7D8QtZC
BPSBFdQGzlZpSnHYd9N/62HB/5qKT+YlMcxW2x6ZGAlQe7QZ3Fl/U/jDDRgz//ry
CUgo6BXXHeXRCbGFmzj0A0X/TwIDAQABo1MwUTAdBgNVHQ4EFgQUdM48GijJtTO4
ypOH9Sx67/dqYHIwHwYDVR0jBBgwFoAUdM48GijJtTO4ypOH9Sx67/dqYHIwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAXNmEpc2n7/fxwyxegR2E
QDKtF/R1dJGVcBXIyaqhche139zANrOM7rwuQJ20/S09qRuDoevpKt8b3Mt/d96n
1WoySPget2yW0MBvsNy13/Lll64ynp4GyazQQLBerOV6xi16EHDJ5ruGdu35mWVS
EcDuUZsKFiV9RalatgKyM7N9lA7FujiAwo0t6SNim3Jci11hvZLphcyeECAcCsud
VTL8qTORn3eMp1H1MQ5pmkputlHrE3J4Us5In6iS4HLt15ioj+bQMGPsOK2/KDBr
MPsBYhFtHKbsmDce9mXV7PkARUumiTqjXqGlKt2QGtqfxTOsoCF4fQNtqqpWmUBw
iA==
-----END CERTIFICATE-----`;

const DEBUG_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIC5DCCAcwCAQEwDQYJKoZIhvcNAQELBQAwNzEWMBQGA1UEAwwNQW5kcm9pZCBE
ZWJ1ZzEQMA4GA1UECgwHQW5kcm9pZDELMAkGA1UEBhMCVVMwIBcNMjYwODAyMjAx
MzAzWhgPMjA1NjA3MjUyMDEzMDNaMDcxFjAUBgNVBAMMDUFuZHJvaWQgRGVidWcx
EDAOBgNVBAoMB0FuZHJvaWQxCzAJBgNVBAYTAlVTMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAwLgq+kyJFuO3aTDrzvCICeLHXOe/cpUj8s4LFUz8GDwf
r9aNO6DhKzk6NIVPcoul1G+xgXu+R8h7ANsueeQ5L6ZO326v+7UNJ0cI+jt2V0Qp
o5/jFsY1j5lhH42ArnWJJHF2x8kOpDEmQtKo1rveUlXyq+qh73p7Lp6ulivXT6MZ
yF1Fv6Ni27E4EZBD4xkfQHFQpMLcuVzeWEXyxdvtUdQUgpB9HqwnZISblA/KY7Rq
KYQWymD+pYzRBl2xuZzTbyX0BXD1cHPCx+6RPrl2ZyfKefcNf20c3NaZeM6tSWMS
nkd48X0LIBFH4Cp4aB4JA1CFLlQgUbx/FFdiHgzOswIDAQABMA0GCSqGSIb3DQEB
CwUAA4IBAQBwl4hDyDf0tZ3gb3W/WhkoPDyoL0UErw1zH0cO5JW/3VxlyHOMNdye
+jDY2fEujDV3yVtZItrMSy7uqYUy/f8QB82+TfaEm3youW+k6KG1cau4HCkqyPbm
6fFA4gFK+JrbymRNvXEbXLUd7NGYm37/Tn0qIZixIt4STaOvySmDZ/0yBxTrslly
pj7MgaNA7MV+Dg/Ooqg/N1ub9WsEGW/oQPBBIGGhlxw+Hu6+SF9r/aBTkxMUy8oL
FJLMkV3qnJ4LfBIv8mJVByIoCGIPjza4UDt2SO8ERbMYqv3FiW9HeV60yeehGoHL
CSjTGGbPG13kxl1TgDYbPwvpmZp++exU
-----END CERTIFICATE-----`;

function certificateReport(label, subject, sha256, certificate) {
  return `${label} certificate DN: ${subject}
${label} certificate SHA-256 digest: ${sha256}
${label} certificate SHA-1 digest: ${"1".repeat(40)}
${certificate}
`;
}

function apkSignerReport(certificates) {
  return `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Number of signers: ${certificates.length}
${certificates.join("")}`;
}

const RELEASE_REPORT = certificateReport(
  "V2 Signer",
  "C=CH, O=Solid Native, CN=Release Fixture",
  RELEASE_SHA256,
  RELEASE_CERTIFICATE,
);
const ROTATED_REPORT = certificateReport(
  "Signer (minSdkVersion=33, maxSdkVersion=2147483647)",
  "C=CH, O=Solid Native, CN=Rotated Fixture",
  ROTATED_SHA256,
  ROTATED_CERTIFICATE,
);
const DEBUG_REPORT = certificateReport(
  "V2 Signer",
  "C=US, O=Android, CN=Android Debug",
  DEBUG_SHA256,
  DEBUG_CERTIFICATE,
);

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
    path.join(tmpdir(), "solid-native-android-apk-signing-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "app-release.apk");
  await writeFile(artifactPath, "signed application package");
  return { artifactPath, directory };
}

test("parses bounded APK signer certificates including rotation", () => {
  assert.deepEqual(
    parseNativeAndroidApkSigners(apkSignerReport([RELEASE_REPORT])),
    [{ certificateSha256: RELEASE_SHA256, debug: false }],
  );
  assert.deepEqual(
    parseNativeAndroidApkSigners(
      apkSignerReport([RELEASE_REPORT, ROTATED_REPORT]),
    ),
    [
      { certificateSha256: ROTATED_SHA256, debug: false },
      { certificateSha256: RELEASE_SHA256, debug: false },
    ],
  );
  assert.deepEqual(
    parseNativeAndroidApkSigners(apkSignerReport([DEBUG_REPORT])),
    [{ certificateSha256: DEBUG_SHA256, debug: true }],
  );
  assert.deepEqual(
    parseNativeAndroidApkSigners(
      `${apkSignerReport([RELEASE_REPORT])}${certificateReport(
        "Source Stamp Signer",
        "C=CH, O=Solid Native, CN=Release Fixture",
        RELEASE_SHA256,
        RELEASE_CERTIFICATE,
      )}`,
    ),
    [{ certificateSha256: RELEASE_SHA256, debug: false }],
  );
  assert.throws(
    () =>
      parseNativeAndroidApkSigners(
        apkSignerReport([
          RELEASE_REPORT.replace(RELEASE_SHA256, "00".repeat(32)),
        ]),
      ),
    /certificate bytes do not match/u,
  );
  assert.throws(
    () =>
      parseNativeAndroidApkSigners(
        "Verifies\nNumber of signers: 1\nNumber of signers: 1\n",
      ),
    /exactly one bounded signer count/u,
  );
});

test("verifies an immutable APK snapshot and exact signer set", async (t) => {
  const { artifactPath, directory } = await fixture(t);
  let inspectedPath;
  const report = await verifyNativeAndroidApkSigning({
    artifactPath,
    cwd: directory,
    expectedCertificateSha256s: [RELEASE_SHA256.toUpperCase(), ROTATED_SHA256],
    env: {},
    dependencies: {
      async resolveApkSignerCommand() {
        return "/fixture/apksigner";
      },
      async runCommand(command, args, context) {
        assert.equal(command, "/fixture/apksigner");
        assert.deepEqual(args.slice(0, -1), [
          "verify",
          "--verbose",
          "--print-certs-pem",
          "--Werr",
        ]);
        assert.equal(context.timeoutMs, 30_000);
        assert.equal(context.env.LC_ALL, "C");
        inspectedPath = args.at(-1);
        assert.notEqual(inspectedPath, artifactPath);
        return commandResult(apkSignerReport([RELEASE_REPORT, ROTATED_REPORT]));
      },
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.artifact.name, "app-release.apk");
  assert.equal(report.artifact.bytes, 26);
  assert.deepEqual(
    report.checks.map((entry) => [entry.id, entry.status]),
    [
      ["signature-integrity", "pass"],
      ["signer-certificate", "pass"],
      ["debug-certificate", "pass"],
      ["expected-certificate", "pass"],
    ],
  );
  assert.match(formatNativeAndroidApkSigningReport(report), /Ready:/u);
  assert.equal(
    await lstat(path.dirname(inspectedPath)).catch(() => undefined),
    undefined,
  );
});

test("rejects debug, invalid, and unexpected APK signing identities", async (t) => {
  const { artifactPath, directory } = await fixture(t);
  const dependencies = (output, exitCode = 0) => ({
    async resolveApkSignerCommand() {
      return "/fixture/apksigner";
    },
    async runCommand() {
      return commandResult(output, exitCode);
    },
  });
  const debug = await verifyNativeAndroidApkSigning({
    artifactPath,
    dependencies: dependencies(apkSignerReport([DEBUG_REPORT])),
  });
  assert.equal(debug.ok, false);
  assert.equal(
    debug.checks.find((entry) => entry.id === "debug-certificate")?.status,
    "fail",
  );
  assert.match(formatNativeAndroidApkSigningReport(debug), /Not ready/u);

  const unsigned = await verifyNativeAndroidApkSigning({
    artifactPath,
    dependencies: dependencies("DOES NOT VERIFY\n", 1),
  });
  assert.equal(unsigned.ok, false);
  assert.deepEqual(unsigned.signers, []);

  const unexpected = await verifyNativeAndroidApkSigning({
    artifactPath,
    expectedCertificateSha256s: [ROTATED_SHA256],
    dependencies: dependencies(apkSignerReport([RELEASE_REPORT])),
  });
  assert.equal(unexpected.ok, false);
  assert.equal(
    unexpected.checks.find((entry) => entry.id === "expected-certificate")
      ?.status,
    "fail",
  );

  await assert.rejects(
    verifyNativeAndroidApkSigning({
      artifactPath,
      expectedCertificateSha256s: [RELEASE_SHA256, RELEASE_SHA256],
    }),
    /must not contain duplicates/u,
  );
  await assert.rejects(
    verifyNativeAndroidApkSigning({
      artifactPath: path.join(directory, "app-release.aab"),
    }),
    /requires an \.apk file/u,
  );
});

test("fails closed on linked APKs, tool failures, and artifact races", async (t) => {
  const { artifactPath, directory } = await fixture(t);
  if (process.platform !== "win32") {
    const linkedArtifactPath = path.join(directory, "linked-release.apk");
    await symlink(artifactPath, linkedArtifactPath);
    await assert.rejects(
      verifyNativeAndroidApkSigning({ artifactPath: linkedArtifactPath }),
      /readable non-linked regular file/u,
    );
  }
  const dependencies = {
    async resolveApkSignerCommand() {
      return "/fixture/apksigner";
    },
    async runCommand() {
      return {
        ...commandResult(""),
        exitCode: null,
        errorCode: "ENOENT",
      };
    },
  };
  await assert.rejects(
    verifyNativeAndroidApkSigning({ artifactPath, dependencies }),
    /Install Android SDK Build Tools/u,
  );
  await assert.rejects(
    verifyNativeAndroidApkSigning({
      artifactPath,
      dependencies: {
        ...dependencies,
        async runCommand() {
          return { ...commandResult(""), timedOut: true };
        },
      },
    }),
    /timed out while inspecting/u,
  );
  await assert.rejects(
    verifyNativeAndroidApkSigning({
      artifactPath,
      dependencies: {
        ...dependencies,
        async runCommand() {
          return { ...commandResult(""), outputTruncated: true };
        },
      },
    }),
    /output exceeded 262144 bytes/u,
  );
  await assert.rejects(
    verifyNativeAndroidApkSigning({
      artifactPath,
      dependencies: {
        ...dependencies,
        async runCommand() {
          await writeFile(artifactPath, "changed application package");
          return commandResult(apkSignerReport([RELEASE_REPORT]));
        },
      },
    }),
    /changed while its signing identity was inspected/u,
  );
});

test("resolves the newest stable Android SDK apksigner", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "solid-native-apksigner-sdk-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const version of ["34.0.0", "37.0.0", "38.0.0-rc1"]) {
    const versionDirectory = path.join(directory, "build-tools", version);
    await mkdir(versionDirectory, { recursive: true });
    await writeFile(
      path.join(
        versionDirectory,
        process.platform === "win32" ? "apksigner.bat" : "apksigner",
      ),
      "fixture",
      { mode: 0o755 },
    );
  }
  assert.equal(
    await resolveNativeAndroidApkSignerCommand({ ANDROID_HOME: directory }),
    path.join(
      directory,
      "build-tools",
      "37.0.0",
      process.platform === "win32" ? "apksigner.bat" : "apksigner",
    ),
  );
  await assert.rejects(
    resolveNativeAndroidApkSignerCommand({
      ANDROID_HOME: directory,
      ANDROID_SDK_ROOT: path.join(directory, "different"),
    }),
    /identify different Android SDK directories/u,
  );
});
