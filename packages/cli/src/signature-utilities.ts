import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

const MAX_KEY_BYTES = 64 * 1024;
const MAX_DETACHED_SIGNATURE_BYTES = 1024;
const BASE64URL_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const SPKI_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{1,512}$/u;

export interface StableRegularFile {
  readonly bytes: Buffer;
  readonly mode: number;
}

export interface DetachedEd25519Signature {
  readonly base64url: string;
  readonly bytes: Buffer;
}

export async function readStableRegularFile(
  filePath: string,
  label: string,
  maximumBytes: number,
): Promise<StableRegularFile> {
  let handle: FileHandle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new TypeError(`${label} ${filePath} is missing or unreadable.`);
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size === 0 || before.size > maximumBytes) {
      throw new TypeError(
        `${label} must be a 1-${maximumBytes} byte regular file.`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !after.isFile() ||
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      after.mode !== before.mode
    ) {
      throw new TypeError(`${label} changed while being read.`);
    }
    return { bytes, mode: before.mode };
  } finally {
    await handle.close();
  }
}

export function assertEd25519Key(key: KeyObject, label: string): KeyObject {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError(`${label} must contain an Ed25519 key.`);
  }
  return key;
}

export async function readEd25519PrivateKey(
  privateKeyPath: string,
): Promise<KeyObject> {
  const file = await readStableRegularFile(
    privateKeyPath,
    "Private key",
    MAX_KEY_BYTES,
  );
  if (process.platform !== "win32" && (file.mode & 0o077) !== 0) {
    throw new TypeError(
      "The private key must not be readable or writable by group or other users.",
    );
  }
  try {
    return assertEd25519Key(createPrivateKey(file.bytes), "The private key");
  } catch (error) {
    if (error instanceof TypeError && /Ed25519/u.test(error.message)) {
      throw error;
    }
    throw new TypeError(
      `The private key is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readEd25519PublicKey(
  publicKeyPath: string,
): Promise<KeyObject> {
  const file = await readStableRegularFile(
    publicKeyPath,
    "Public key",
    MAX_KEY_BYTES,
  );
  try {
    return assertEd25519Key(createPublicKey(file.bytes), "The public key");
  } catch (error) {
    if (error instanceof TypeError && /Ed25519/u.test(error.message)) {
      throw error;
    }
    throw new TypeError(
      `The public key is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function publicEd25519KeyFromSpki(
  value: unknown,
  label: string,
): KeyObject {
  if (typeof value !== "string" || !SPKI_BASE64URL_PATTERN.test(value)) {
    throw new TypeError(`${label} must be canonical base64url SPKI.`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new TypeError(`${label} must be canonical base64url SPKI.`);
  }
  try {
    const key = assertEd25519Key(
      createPublicKey({ key: bytes, format: "der", type: "spki" }),
      label,
    );
    const canonical = key.export({ format: "der", type: "spki" });
    if (!Buffer.isBuffer(canonical) || !canonical.equals(bytes)) {
      throw new TypeError(`${label} is not canonical Ed25519 SPKI.`);
    }
    return key;
  } catch (error) {
    if (error instanceof TypeError && /SPKI|Ed25519/u.test(error.message)) {
      throw error;
    }
    throw new TypeError(
      `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readDetachedEd25519Signature(
  detachedSignaturePath: string,
): Promise<DetachedEd25519Signature> {
  const file = await readStableRegularFile(
    detachedSignaturePath,
    "Detached Ed25519 signature",
    MAX_DETACHED_SIGNATURE_BYTES,
  );
  let bytes: Buffer;
  if (file.bytes.length === 64) {
    bytes = file.bytes;
  } else {
    const text = file.bytes.toString("utf8").replace(/\n$/u, "");
    if (!BASE64URL_SIGNATURE_PATTERN.test(text)) {
      throw new TypeError(
        "The detached Ed25519 signature must contain 64 raw bytes or canonical base64url.",
      );
    }
    bytes = Buffer.from(text, "base64url");
    if (bytes.toString("base64url") !== text) {
      throw new TypeError(
        "The detached Ed25519 signature must contain canonical base64url.",
      );
    }
  }
  if (bytes.length !== 64) {
    throw new TypeError("The detached Ed25519 signature must be 64 bytes.");
  }
  return Object.freeze({ base64url: bytes.toString("base64url"), bytes });
}
