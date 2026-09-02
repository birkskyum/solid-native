import path from "node:path";

import {
  readNativeBundleManifest,
  verifyNativeBundleManifest,
  type NativeBundleArtifact,
} from "./bundle-artifacts.js";
import {
  formatNativeReleaseSignatureVerification,
  verifyNativeReleaseSignature,
  type NativeAuthorizedRelease,
  type VerifyNativeReleaseSignatureWithInputsOptions,
} from "./release-signatures.js";

export type CreateNativeSymbolicationHandoffOptions =
  VerifyNativeReleaseSignatureWithInputsOptions;

export interface NativeSymbolicationArtifact extends NativeBundleArtifact {
  /** Ephemeral local input for an uploader; excluded from release identity. */
  readonly localPath: string;
}

export interface NativeSymbolicationHandoff {
  readonly schemaVersion: 0;
  readonly kind: "solid-native.symbolication-handoff";
  readonly algorithm: "sha256";
  readonly entryPoint: string;
  readonly minified: boolean;
  readonly artifacts: Readonly<{
    readonly bundle: NativeSymbolicationArtifact;
    readonly sourceMap: NativeSymbolicationArtifact;
  }>;
  /** The same complete verifier output accepted by runtime telemetry. */
  readonly authorizedRelease: NativeAuthorizedRelease;
}

function localArtifact(
  bundleDirectory: string,
  artifact: NativeBundleArtifact,
): NativeSymbolicationArtifact {
  const localPath = path.resolve(bundleDirectory, ...artifact.path.split("/"));
  const relative = path.relative(bundleDirectory, localPath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new TypeError(
      `Symbolication artifact ${artifact.path} escapes its bundle directory.`,
    );
  }
  return Object.freeze({ ...artifact, localPath });
}

/**
 * Authenticates every release input and prepares an uploader-neutral bundle/map
 * descriptor. The local paths are operational inputs, never signed identity.
 */
export async function createNativeSymbolicationHandoff(
  options: CreateNativeSymbolicationHandoffOptions,
): Promise<NativeSymbolicationHandoff> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const bundleManifestPath = path.resolve(cwd, options.bundleManifestPath);
  const verification = await verifyNativeReleaseSignature({
    ...options,
    cwd,
    bundleManifestPath,
    artifactPath: path.resolve(cwd, options.artifactPath),
  });
  if (!verification.ok || !verification.authorizedRelease.inputsVerified) {
    throw new TypeError(
      `Refusing to prepare symbolication from an unauthorized release.\n${formatNativeReleaseSignatureVerification(verification)}`,
    );
  }

  // Repeat the bundle proof at the handoff boundary so the paths and digests
  // below describe the bytes that were still present after authorization.
  const [manifest, bundleVerification] = await Promise.all([
    readNativeBundleManifest(bundleManifestPath),
    verifyNativeBundleManifest(bundleManifestPath),
  ]);
  if (
    !bundleVerification.ok ||
    bundleVerification.bundleFingerprint !==
      verification.authorizedRelease.bundleFingerprint ||
    manifest.bundleFingerprint !==
      verification.authorizedRelease.bundleFingerprint ||
    manifest.platform !== verification.authorizedRelease.platform
  ) {
    throw new TypeError(
      "Refusing to prepare symbolication because the authenticated bundle changed or has the wrong platform.",
    );
  }

  const bundleDirectory = path.dirname(bundleManifestPath);
  return Object.freeze({
    schemaVersion: 0,
    kind: "solid-native.symbolication-handoff",
    algorithm: "sha256",
    entryPoint: manifest.entryPoint,
    minified: manifest.minified,
    artifacts: Object.freeze({
      bundle: localArtifact(bundleDirectory, manifest.artifacts.bundle),
      sourceMap: localArtifact(bundleDirectory, manifest.artifacts.sourceMap),
    }),
    authorizedRelease: verification.authorizedRelease,
  });
}

export function formatNativeSymbolicationHandoff(
  handoff: NativeSymbolicationHandoff,
): string {
  const release = handoff.authorizedRelease;
  return [
    `PASS Solid Native symbolication handoff ${release.releaseFingerprint}`,
    `Release: ${release.projectName}/${release.release} (${release.platform}, ${release.channel})`,
    `Bundle: ${handoff.artifacts.bundle.localPath} (${handoff.artifacts.bundle.sha256})`,
    `Source map: ${handoff.artifacts.sourceMap.localPath} (${handoff.artifacts.sourceMap.sha256})`,
    `Authenticated key: ${release.authenticatedKeyId}`,
    ...(release.trustPolicyFingerprint === undefined
      ? []
      : [
          `Trust policy: ${release.trustPolicyFingerprint} (sequence ${String(release.trustPolicySequence)})`,
        ]),
    "",
    "Upload is intentionally delegated to the selected backend; it must verify the declared bytes and SHA-256 immediately before transport.",
  ].join("\n");
}
