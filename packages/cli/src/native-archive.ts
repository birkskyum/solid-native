import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { crc32, inflateRawSync } from "node:zlib";

import { VERIFIED_HERMES_BYTECODE_VERSION } from "./versions.js";

export interface NativeEmbeddedBundleArtifact {
  readonly path: string;
  readonly format: "hermes-bytecode";
  readonly bytecodeVersion: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceSha1: string;
}

export interface IOSNativeEmbeddedBundleInspection {
  readonly artifact: NativeEmbeddedBundleArtifact;
  readonly compilationSourceName?: string;
}

interface ZipEntry {
  readonly path: string;
  readonly flags: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly localHeaderOffset: number;
}

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_CENTRAL_DIGITAL_SIGNATURE = 0x05054b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_END_FIXED_BYTES = 56;
const MAX_ZIP64_END_BYTES = 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 100_000;
const MAX_NATIVE_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_EMBEDDED_BUNDLE_BYTES = 256 * 1024 * 1024;
const HERMES_HEADER_BYTES = 32;
const HERMES_FOOTER_BYTES = 20;
const HERMES_MAGIC = Buffer.from([
  0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f,
]);
const ANDROID_BUNDLE_PATHS = new Set([
  "assets/index.android.bundle",
  "base/assets/index.android.bundle",
]);
const IOS_BUNDLE_PATH = /^Payload\/[^/]{1,255}\.app\/main\.jsbundle$/u;
const IOS_COMPILATION_SOURCE_SUFFIX = Buffer.from("main.jsbundle");
const MAX_IOS_COMPILATION_SOURCE_BYTES = 4_096;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function decodeUTF8(bytes: Buffer, failure: string): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    throw new TypeError(failure);
  }
}

async function readExactly(
  handle: FileHandle,
  position: number,
  length: number,
  label: string,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    throw new TypeError(`${label} declares an invalid byte range.`);
  }
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead === 0) {
      throw new TypeError(`${label} is truncated.`);
    }
    offset += bytesRead;
  }
  return buffer;
}

function findEndRecord(tail: Buffer): number {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue;
    const commentBytes = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentBytes === tail.length) return offset;
  }
  throw new TypeError("The native artifact has no canonical ZIP end record.");
}

function parseCentralDirectory(
  central: Buffer,
  entryCount: number,
): readonly ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > central.length ||
      central.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE
    ) {
      throw new TypeError("The native artifact ZIP directory is malformed.");
    }
    const flags = central.readUInt16LE(offset + 8);
    const compressionMethod = central.readUInt16LE(offset + 10);
    const expectedCrc32 = central.readUInt32LE(offset + 16);
    let compressedBytes = central.readUInt32LE(offset + 20);
    let uncompressedBytes = central.readUInt32LE(offset + 24);
    const nameBytes = central.readUInt16LE(offset + 28);
    const extraBytes = central.readUInt16LE(offset + 30);
    const commentBytes = central.readUInt16LE(offset + 32);
    let disk = central.readUInt16LE(offset + 34);
    let localHeaderOffset = central.readUInt32LE(offset + 42);
    const end = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (end > central.length || (disk !== 0 && disk !== 0xffff)) {
      throw new TypeError("The native artifact ZIP directory is malformed.");
    }
    const nameBuffer = central.subarray(offset + 46, offset + 46 + nameBytes);
    if (nameBuffer.includes(0)) {
      throw new TypeError("The native artifact ZIP contains an invalid path.");
    }
    const entryPath = decodeUTF8(
      nameBuffer,
      "The native artifact ZIP contains a non-UTF-8 path.",
    );
    const extra = central.subarray(
      offset + 46 + nameBytes,
      offset + 46 + nameBytes + extraBytes,
    );
    const zip64 = readZip64EntryValues(extra, {
      uncompressedBytes: uncompressedBytes === 0xffffffff,
      compressedBytes: compressedBytes === 0xffffffff,
      localHeaderOffset: localHeaderOffset === 0xffffffff,
      disk: disk === 0xffff,
    });
    uncompressedBytes = zip64.uncompressedBytes ?? uncompressedBytes;
    compressedBytes = zip64.compressedBytes ?? compressedBytes;
    localHeaderOffset = zip64.localHeaderOffset ?? localHeaderOffset;
    disk = zip64.disk ?? disk;
    if (disk !== 0) {
      throw new TypeError("Multi-disk native artifacts are not supported.");
    }
    entries.push({
      path: entryPath,
      flags,
      compressionMethod,
      crc32: expectedCrc32,
      compressedBytes,
      uncompressedBytes,
      localHeaderOffset,
    });
    offset = end;
  }
  if (offset !== central.length) {
    if (
      offset + 6 > central.length ||
      central.readUInt32LE(offset) !== ZIP_CENTRAL_DIGITAL_SIGNATURE ||
      offset + 6 + central.readUInt16LE(offset + 4) !== central.length
    ) {
      throw new TypeError("The native artifact ZIP directory is malformed.");
    }
  }
  return entries;
}

interface Zip64EntryRequirements {
  readonly uncompressedBytes: boolean;
  readonly compressedBytes: boolean;
  readonly localHeaderOffset: boolean;
  readonly disk: boolean;
}

function safeUInt64(buffer: Buffer, offset: number, label: string): number {
  if (offset + 8 > buffer.length) {
    throw new TypeError(`${label} is truncated.`);
  }
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${label} exceeds the safe integer range.`);
  }
  return Number(value);
}

function readZip64EntryValues(
  extra: Buffer,
  requirements: Zip64EntryRequirements,
): Partial<{
  readonly uncompressedBytes: number;
  readonly compressedBytes: number;
  readonly localHeaderOffset: number;
  readonly disk: number;
}> {
  let zip64: Buffer | undefined;
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) {
      throw new TypeError(
        "The native artifact ZIP extra fields are malformed.",
      );
    }
    const id = extra.readUInt16LE(offset);
    const bytes = extra.readUInt16LE(offset + 2);
    const end = offset + 4 + bytes;
    if (end > extra.length) {
      throw new TypeError(
        "The native artifact ZIP extra fields are malformed.",
      );
    }
    if (id === 0x0001) {
      if (zip64 !== undefined) {
        throw new TypeError(
          "The native artifact ZIP contains duplicate ZIP64 metadata.",
        );
      }
      zip64 = extra.subarray(offset + 4, end);
    }
    offset = end;
  }
  const requiresZip64 = Object.values(requirements).some(Boolean);
  if (!requiresZip64) return {};
  if (zip64 === undefined) {
    throw new TypeError(
      "The native artifact ZIP entry is missing required ZIP64 metadata.",
    );
  }
  let zip64Offset = 0;
  const values: {
    uncompressedBytes?: number;
    compressedBytes?: number;
    localHeaderOffset?: number;
    disk?: number;
  } = {};
  if (requirements.uncompressedBytes) {
    values.uncompressedBytes = safeUInt64(
      zip64,
      zip64Offset,
      "The native artifact ZIP64 uncompressed size",
    );
    zip64Offset += 8;
  }
  if (requirements.compressedBytes) {
    values.compressedBytes = safeUInt64(
      zip64,
      zip64Offset,
      "The native artifact ZIP64 compressed size",
    );
    zip64Offset += 8;
  }
  if (requirements.localHeaderOffset) {
    values.localHeaderOffset = safeUInt64(
      zip64,
      zip64Offset,
      "The native artifact ZIP64 local-header offset",
    );
    zip64Offset += 8;
  }
  if (requirements.disk) {
    if (zip64Offset + 4 > zip64.length) {
      throw new TypeError(
        "The native artifact ZIP64 disk number is truncated.",
      );
    }
    values.disk = zip64.readUInt32LE(zip64Offset);
  }
  return values;
}

interface ZipDirectoryLocation {
  readonly entryCount: number;
  readonly centralBytes: number;
  readonly centralOffset: number;
  readonly endOffset: number;
}

function legacyValueMatches(
  legacy: number,
  sentinel: number,
  zip64: number,
): boolean {
  return legacy === sentinel || legacy === zip64;
}

async function readZip64DirectoryLocation(
  handle: FileHandle,
  classic: Readonly<{
    disk: number;
    centralDisk: number;
    diskEntries: number;
    entryCount: number;
    centralBytes: number;
    centralOffset: number;
    endOffset: number;
  }>,
): Promise<ZipDirectoryLocation> {
  if (
    classic.disk !== 0 ||
    classic.centralDisk !== 0 ||
    classic.endOffset < ZIP64_LOCATOR_BYTES
  ) {
    throw new TypeError("Multi-disk native artifacts are not supported.");
  }
  const locatorOffset = classic.endOffset - ZIP64_LOCATOR_BYTES;
  const locator = await readExactly(
    handle,
    locatorOffset,
    ZIP64_LOCATOR_BYTES,
    "The native artifact ZIP64 locator",
  );
  if (
    locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE ||
    locator.readUInt32LE(4) !== 0 ||
    locator.readUInt32LE(16) !== 1
  ) {
    throw new TypeError("The native artifact ZIP64 locator is malformed.");
  }
  const zip64EndOffset = safeUInt64(
    locator,
    8,
    "The native artifact ZIP64 end-record offset",
  );
  if (zip64EndOffset > locatorOffset - ZIP64_END_FIXED_BYTES) {
    throw new TypeError(
      "The native artifact ZIP64 end record is out of bounds.",
    );
  }
  const fixed = await readExactly(
    handle,
    zip64EndOffset,
    ZIP64_END_FIXED_BYTES,
    "The native artifact ZIP64 end record",
  );
  if (fixed.readUInt32LE(0) !== ZIP64_END_SIGNATURE) {
    throw new TypeError("The native artifact ZIP64 end record is malformed.");
  }
  const recordBytes = safeUInt64(
    fixed,
    4,
    "The native artifact ZIP64 end-record size",
  );
  if (
    recordBytes < ZIP64_END_FIXED_BYTES - 12 ||
    recordBytes > MAX_ZIP64_END_BYTES ||
    zip64EndOffset + 12 + recordBytes !== locatorOffset ||
    fixed.readUInt32LE(16) !== 0 ||
    fixed.readUInt32LE(20) !== 0
  ) {
    throw new TypeError("The native artifact ZIP64 end record is malformed.");
  }
  const diskEntries = safeUInt64(
    fixed,
    24,
    "The native artifact ZIP64 disk-entry count",
  );
  const entryCount = safeUInt64(
    fixed,
    32,
    "The native artifact ZIP64 entry count",
  );
  const centralBytes = safeUInt64(
    fixed,
    40,
    "The native artifact ZIP64 directory size",
  );
  const centralOffset = safeUInt64(
    fixed,
    48,
    "The native artifact ZIP64 directory offset",
  );
  if (
    diskEntries !== entryCount ||
    !legacyValueMatches(classic.diskEntries, 0xffff, diskEntries) ||
    !legacyValueMatches(classic.entryCount, 0xffff, entryCount) ||
    !legacyValueMatches(classic.centralBytes, 0xffffffff, centralBytes) ||
    !legacyValueMatches(classic.centralOffset, 0xffffffff, centralOffset)
  ) {
    throw new TypeError("The native artifact ZIP64 directory is inconsistent.");
  }
  return {
    entryCount,
    centralBytes,
    centralOffset,
    endOffset: zip64EndOffset,
  };
}

async function readZipEntries(
  handle: FileHandle,
  archiveBytes: number,
): Promise<readonly ZipEntry[]> {
  const tailBytes = Math.min(
    archiveBytes,
    22 + MAX_ZIP_COMMENT_BYTES + ZIP64_LOCATOR_BYTES,
  );
  const tail = await readExactly(
    handle,
    archiveBytes - tailBytes,
    tailBytes,
    "The native artifact ZIP end record",
  );
  const endOffset = findEndRecord(tail);
  const disk = tail.readUInt16LE(endOffset + 4);
  const centralDisk = tail.readUInt16LE(endOffset + 6);
  const diskEntries = tail.readUInt16LE(endOffset + 8);
  const entryCount = tail.readUInt16LE(endOffset + 10);
  const centralBytes = tail.readUInt32LE(endOffset + 12);
  const centralOffset = tail.readUInt32LE(endOffset + 16);
  const absoluteEndOffset = archiveBytes - tailBytes + endOffset;
  const usesZip64 =
    diskEntries === 0xffff ||
    entryCount === 0xffff ||
    centralBytes === 0xffffffff ||
    centralOffset === 0xffffffff;
  let location: ZipDirectoryLocation;
  if (usesZip64) {
    location = await readZip64DirectoryLocation(handle, {
      disk,
      centralDisk,
      diskEntries,
      entryCount,
      centralBytes,
      centralOffset,
      endOffset: absoluteEndOffset,
    });
  } else {
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
      throw new TypeError("Multi-disk native artifacts are not supported.");
    }
    location = {
      entryCount,
      centralBytes,
      centralOffset,
      endOffset: absoluteEndOffset,
    };
  }
  if (
    location.entryCount === 0 ||
    location.entryCount > MAX_ZIP_ENTRIES ||
    location.centralBytes === 0 ||
    location.centralBytes > MAX_CENTRAL_DIRECTORY_BYTES ||
    location.centralOffset > location.endOffset ||
    location.centralBytes > location.endOffset - location.centralOffset
  ) {
    throw new TypeError("The native artifact ZIP directory is out of bounds.");
  }
  const central = await readExactly(
    handle,
    location.centralOffset,
    location.centralBytes,
    "The native artifact ZIP directory",
  );
  return parseCentralDirectory(central, location.entryCount);
}

async function readZipEntry(
  handle: FileHandle,
  archiveBytes: number,
  entry: ZipEntry,
): Promise<Buffer> {
  if (
    (entry.flags & 0x1) !== 0 ||
    (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
  ) {
    throw new TypeError(
      "The embedded Hermes bundle must be unencrypted and stored or deflated.",
    );
  }
  if (
    entry.uncompressedBytes < HERMES_HEADER_BYTES ||
    entry.uncompressedBytes > MAX_EMBEDDED_BUNDLE_BYTES ||
    entry.compressedBytes === 0 ||
    entry.compressedBytes > MAX_EMBEDDED_BUNDLE_BYTES
  ) {
    throw new TypeError("The embedded Hermes bundle has an invalid size.");
  }
  if (entry.localHeaderOffset > archiveBytes - 30) {
    throw new TypeError("The embedded Hermes bundle ZIP header is truncated.");
  }
  const local = await readExactly(
    handle,
    entry.localHeaderOffset,
    30,
    "The embedded Hermes bundle ZIP header",
  );
  if (
    local.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE ||
    local.readUInt16LE(6) !== entry.flags ||
    local.readUInt16LE(8) !== entry.compressionMethod
  ) {
    throw new TypeError(
      "The embedded Hermes bundle ZIP header is inconsistent.",
    );
  }
  const nameBytes = local.readUInt16LE(26);
  const extraBytes = local.readUInt16LE(28);
  const dataOffset = entry.localHeaderOffset + 30 + nameBytes + extraBytes;
  if (dataOffset + entry.compressedBytes > archiveBytes) {
    throw new TypeError("The embedded Hermes bundle ZIP payload is truncated.");
  }
  const localName = await readExactly(
    handle,
    entry.localHeaderOffset + 30,
    nameBytes,
    "The embedded Hermes bundle ZIP path",
  );
  if (!localName.equals(Buffer.from(entry.path, "utf8"))) {
    throw new TypeError("The embedded Hermes bundle ZIP path is inconsistent.");
  }
  const compressed = await readExactly(
    handle,
    dataOffset,
    entry.compressedBytes,
    "The embedded Hermes bundle",
  );
  let bytes: Buffer;
  try {
    bytes =
      entry.compressionMethod === 0
        ? compressed
        : inflateRawSync(compressed, {
            maxOutputLength: MAX_EMBEDDED_BUNDLE_BYTES,
          });
  } catch (error) {
    throw new TypeError(
      `The embedded Hermes bundle cannot be decompressed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    bytes.length !== entry.uncompressedBytes ||
    Number(crc32(bytes)) >>> 0 !== entry.crc32
  ) {
    throw new TypeError(
      "The embedded Hermes bundle does not match its ZIP checksum or size.",
    );
  }
  return bytes;
}

export async function inspectAndroidEmbeddedHermesBundle(
  artifactPath: string,
): Promise<NativeEmbeddedBundleArtifact> {
  return (
    await inspectEmbeddedHermesBundle(artifactPath, "Android", (entry) =>
      ANDROID_BUNDLE_PATHS.has(entry.path),
    )
  ).artifact;
}

function readIOSCompilationSourceName(bytes: Buffer): string | undefined {
  const matches: string[] = [];
  let suffixOffset = bytes.indexOf(IOS_COMPILATION_SOURCE_SUFFIX);
  while (suffixOffset !== -1) {
    const end = suffixOffset + IOS_COMPILATION_SOURCE_SUFFIX.length;
    if (end < bytes.length && bytes[end] === 0) {
      const earliest = Math.max(4, end - MAX_IOS_COMPILATION_SOURCE_BYTES);
      for (let start = suffixOffset - 1; start >= earliest; start -= 1) {
        if (
          bytes[start] !== 0x2f ||
          bytes.readUInt32LE(start - 4) !== end - start
        ) {
          continue;
        }
        const candidateBytes = bytes.subarray(start, end);
        let candidate: string;
        try {
          candidate = UTF8_DECODER.decode(candidateBytes);
        } catch {
          continue;
        }
        if (
          candidate.endsWith("/main.jsbundle") &&
          !/[\0-\x1f\x7f]/u.test(candidate)
        ) {
          matches.push(candidate);
        }
      }
    }
    suffixOffset = bytes.indexOf(
      IOS_COMPILATION_SOURCE_SUFFIX,
      suffixOffset + IOS_COMPILATION_SOURCE_SUFFIX.length,
    );
  }
  if (matches.length > 1) {
    throw new TypeError(
      "The embedded iOS Hermes bytecode has ambiguous compilation source metadata.",
    );
  }
  return matches[0];
}

export async function inspectIOSEmbeddedHermesBundle(
  artifactPath: string,
): Promise<IOSNativeEmbeddedBundleInspection> {
  const inspection = await inspectEmbeddedHermesBundle(
    artifactPath,
    "iOS",
    (entry) => IOS_BUNDLE_PATH.test(entry.path),
  );
  const compilationSourceName = readIOSCompilationSourceName(inspection.bytes);
  return {
    artifact: inspection.artifact,
    ...(compilationSourceName === undefined ? {} : { compilationSourceName }),
  };
}

async function inspectEmbeddedHermesBundle(
  artifactPath: string,
  platform: "Android" | "iOS",
  acceptsEntry: (entry: ZipEntry) => boolean,
): Promise<{
  readonly artifact: NativeEmbeddedBundleArtifact;
  readonly bytes: Buffer;
}> {
  let handle: FileHandle;
  try {
    handle = await open(
      artifactPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch {
    throw new TypeError(
      `${platform} release artifact ${artifactPath} is missing or unreadable.`,
    );
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size === 0 ||
      !Number.isSafeInteger(before.size) ||
      before.size > MAX_NATIVE_ARCHIVE_BYTES
    ) {
      throw new TypeError(
        `The ${platform} release artifact must be a bounded regular file.`,
      );
    }
    const entries = await readZipEntries(handle, before.size);
    const candidates = entries.filter(acceptsEntry);
    if (candidates.length !== 1) {
      throw new TypeError(
        `The ${platform} release artifact must contain exactly one Hermes bundle; found ${candidates.length}.`,
      );
    }
    const entry = candidates[0]!;
    const bytes = await readZipEntry(handle, before.size, entry);
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new TypeError(
        `The ${platform} release artifact changed while being inspected.`,
      );
    }
    if (!bytes.subarray(0, HERMES_MAGIC.length).equals(HERMES_MAGIC)) {
      throw new TypeError(
        `The ${platform} release artifact does not contain Hermes bytecode.`,
      );
    }
    const bytecodeVersion = bytes.readUInt32LE(8);
    if (bytecodeVersion !== VERIFIED_HERMES_BYTECODE_VERSION) {
      throw new TypeError(
        `The embedded Hermes bytecode is version ${bytecodeVersion}; expected device-verified version ${VERIFIED_HERMES_BYTECODE_VERSION}.`,
      );
    }
    if (
      bytes.length < HERMES_HEADER_BYTES + HERMES_FOOTER_BYTES ||
      !createHash("sha1")
        .update(bytes.subarray(0, -HERMES_FOOTER_BYTES))
        .digest()
        .equals(bytes.subarray(-HERMES_FOOTER_BYTES))
    ) {
      throw new TypeError(
        "The embedded Hermes bytecode does not match its internal checksum.",
      );
    }
    return {
      artifact: {
        path: entry.path,
        format: "hermes-bytecode",
        bytecodeVersion,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sourceSha1: bytes.subarray(12, HERMES_HEADER_BYTES).toString("hex"),
      },
      bytes,
    };
  } finally {
    await handle.close();
  }
}
