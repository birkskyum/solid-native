import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface NativeAndroidSigningCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
  readonly errorCode?: string;
}

export type NativeAndroidSigningCommandRunner = (
  command: string,
  args: readonly string[],
  context: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }>,
) => Promise<NativeAndroidSigningCommandResult>;

export interface NativeAndroidSigningArtifact {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface NativeAndroidSigningSnapshot {
  readonly artifact: NativeAndroidSigningArtifact;
  readonly directory: string;
  readonly identity: BigIntStats;
  readonly path: string;
  readonly snapshotIdentity: BigIntStats;
}

export const NATIVE_ANDROID_SIGNING_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024;
export const NATIVE_ANDROID_SIGNING_MAX_TOOL_OUTPUT_BYTES = 256 * 1024;
export const NATIVE_ANDROID_SIGNING_TOOL_TIMEOUT_MS = 30_000;
const TOOL_TERMINATION_GRACE_MS = 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function nativeAndroidSigningCommandOutput(
  result: NativeAndroidSigningCommandResult,
): string {
  return `${result.stdout}\n${result.stderr}`;
}

export function normalizeNativeAndroidCertificateSha256(value: string): string {
  const normalized = value.replaceAll(":", "").toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError(
      "The expected Android signing certificate SHA-256 must contain exactly 64 hexadecimal digits.",
    );
  }
  return normalized;
}

export function isNativeAndroidDebugCertificateSubject(
  subject: string,
): boolean {
  const normalized = subject.replaceAll(/\s*\n\s*/gu, ", ");
  return (
    /(?:^|,\s*)CN=Android Debug(?:,|$)/u.test(normalized) &&
    /(?:^|,\s*)O=Android(?:,|$)/u.test(normalized)
  );
}

export const defaultNativeAndroidSigningCommandRunner: NativeAndroidSigningCommandRunner =
  (command, args, context) =>
    new Promise((resolve) => {
      const stdout: { chunks: Buffer[]; bytes: number } = {
        chunks: [],
        bytes: 0,
      };
      const stderr: { chunks: Buffer[]; bytes: number } = {
        chunks: [],
        bytes: 0,
      };
      let settled = false;
      let timedOut = false;
      let outputTruncated = false;
      let retainedOutputBytes = 0;
      let forceTimer: NodeJS.Timeout | undefined;
      const child = spawn(command, [...args], {
        cwd: context.cwd,
        env: context.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const append = (
        target: { chunks: Buffer[]; bytes: number },
        chunk: Buffer,
      ): void => {
        const remaining =
          NATIVE_ANDROID_SIGNING_MAX_TOOL_OUTPUT_BYTES - retainedOutputBytes;
        if (remaining <= 0) {
          outputTruncated = true;
          return;
        }
        const retained = chunk.subarray(0, remaining);
        target.chunks.push(Buffer.from(retained));
        target.bytes += retained.length;
        retainedOutputBytes += retained.length;
        if (retained.length !== chunk.length) outputTruncated = true;
      };
      const output = (target: { chunks: Buffer[]; bytes: number }): string =>
        Buffer.concat(target.chunks, target.bytes).toString("utf8");
      const result = (
        exitCode: number | null,
        errorCode?: string,
      ): NativeAndroidSigningCommandResult => ({
        exitCode,
        stdout: output(stdout),
        stderr: output(stderr),
        timedOut,
        outputTruncated,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      child.stdout.on("data", (chunk: Buffer) => {
        append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        append(stderr, chunk);
      });
      const finish = (result: NativeAndroidSigningCommandResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(result(null, "ETIMEDOUT"));
        }, TOOL_TERMINATION_GRACE_MS);
      }, context.timeoutMs);
      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(result(null, error.code));
      });
      child.on("close", (exitCode) => {
        finish(result(exitCode));
      });
    });

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

export async function createNativeAndroidSigningSnapshot(
  artifactPath: string,
  artifactName: string,
  artifactLabel: string,
): Promise<NativeAndroidSigningSnapshot> {
  let source;
  try {
    source = await open(
      artifactPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch {
    throw new TypeError(
      `The ${artifactLabel} must be a readable non-linked regular file.`,
    );
  }
  let directory: string | undefined;
  try {
    const identity = await source.stat({ bigint: true });
    if (
      !identity.isFile() ||
      identity.size <= 0n ||
      identity.size > BigInt(NATIVE_ANDROID_SIGNING_MAX_ARTIFACT_BYTES)
    ) {
      throw new TypeError(
        `The ${artifactLabel} must be a regular file containing 1-${NATIVE_ANDROID_SIGNING_MAX_ARTIFACT_BYTES} bytes.`,
      );
    }
    directory = await mkdtemp(
      path.join(tmpdir(), "solid-native-android-signing-"),
    );
    const snapshotPath = path.join(directory, artifactName);
    const destination = await open(
      snapshotPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    try {
      const size = Number(identity.size);
      while (position < size) {
        const { bytesRead } = await source.read(
          buffer,
          0,
          Math.min(buffer.length, size - position),
          position,
        );
        if (bytesRead === 0) {
          throw new TypeError(
            `The ${artifactLabel} ended while its immutable signing snapshot was created.`,
          );
        }
        hash.update(buffer.subarray(0, bytesRead));
        let written = 0;
        while (written < bytesRead) {
          const result = await destination.write(
            buffer,
            written,
            bytesRead - written,
            position + written,
          );
          if (result.bytesWritten === 0) {
            throw new TypeError(
              `The ${artifactLabel} signing snapshot could not be completed.`,
            );
          }
          written += result.bytesWritten;
        }
        position += bytesRead;
      }
    } finally {
      await destination.close();
    }
    const [sourceAfter, pathAfter, snapshotIdentity] = await Promise.all([
      source.stat({ bigint: true }),
      lstat(artifactPath, { bigint: true }).catch(() => undefined),
      lstat(snapshotPath, { bigint: true }),
    ]);
    if (
      pathAfter === undefined ||
      !sameFileIdentity(identity, sourceAfter) ||
      !sameFileIdentity(identity, pathAfter) ||
      !snapshotIdentity.isFile() ||
      snapshotIdentity.size !== identity.size
    ) {
      throw new TypeError(
        `The ${artifactLabel} changed while its immutable signing snapshot was created.`,
      );
    }
    return {
      artifact: {
        name: artifactName,
        bytes: Number(identity.size),
        sha256: hash.digest("hex"),
      },
      directory,
      identity,
      path: snapshotPath,
      snapshotIdentity,
    };
  } catch (error) {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await source.close();
  }
}

export async function assertNativeAndroidSigningSnapshotUnchanged(
  artifactPath: string,
  snapshot: NativeAndroidSigningSnapshot,
  artifactLabel: string,
): Promise<void> {
  const [after, snapshotAfter] = await Promise.all([
    lstat(artifactPath, { bigint: true }).catch(() => undefined),
    lstat(snapshot.path, { bigint: true }).catch(() => undefined),
  ]);
  if (
    after === undefined ||
    snapshotAfter === undefined ||
    !sameFileIdentity(snapshot.identity, after) ||
    !sameFileIdentity(snapshot.snapshotIdentity, snapshotAfter)
  ) {
    throw new TypeError(
      `The ${artifactLabel} changed while its signing identity was inspected.`,
    );
  }
}

export async function removeNativeAndroidSigningSnapshot(
  snapshot: NativeAndroidSigningSnapshot,
): Promise<void> {
  await rm(snapshot.directory, { recursive: true, force: true });
}

export function assertNativeAndroidSigningToolCompleted(
  name: string,
  result: NativeAndroidSigningCommandResult,
  artifactLabel: string,
  installHelp: string,
): void {
  if (result.timedOut) {
    throw new TypeError(
      `${name} timed out while inspecting the ${artifactLabel}.`,
    );
  }
  if (result.outputTruncated) {
    throw new TypeError(
      `${name} output exceeded ${NATIVE_ANDROID_SIGNING_MAX_TOOL_OUTPUT_BYTES} bytes while inspecting the ${artifactLabel}.`,
    );
  }
  if (result.exitCode === null) {
    throw new TypeError(`${name} is unavailable. ${installHelp}`);
  }
}
