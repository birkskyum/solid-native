import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OWNER_FILE = "owner.json";
const RESTORE_FILE = "restore.json";
const MAX_LEASE_FILE_BYTES = 4 * 1024;
const INCOMPLETE_LEASE_GRACE_MS = 30_000;
const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type LeaseOwner = Readonly<{
  schemaVersion: 0;
  serial: string;
  token: string;
  processId: number;
  createdAtMilliseconds: number;
}>;

type LeaseRestore = Readonly<{
  schemaVersion: 0;
  token: string;
  originalStayAwake: string;
}>;

export interface NativeAndroidRunLeaseDependencies {
  readonly leaseRoot: string;
  readonly processId: number;
  readonly nowMilliseconds: () => number;
  readonly randomToken: () => string;
  readonly isProcessAlive: (processId: number) => boolean;
}

export interface NativeAndroidRunLease {
  readonly token: string;
}

function systemLeaseRoot(): string {
  const user =
    typeof process.getuid === "function" ? String(process.getuid()) : "user";
  return path.join(tmpdir(), `solid-native-${user}-android-run-leases`);
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}

function dependencies(
  overrides: Partial<NativeAndroidRunLeaseDependencies> | undefined,
): NativeAndroidRunLeaseDependencies {
  return {
    leaseRoot: overrides?.leaseRoot ?? systemLeaseRoot(),
    processId: overrides?.processId ?? process.pid,
    nowMilliseconds: overrides?.nowMilliseconds ?? Date.now,
    randomToken: overrides?.randomToken ?? randomUUID,
    isProcessAlive: overrides?.isProcessAlive ?? processIsAlive,
  };
}

function assertProcessId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new TypeError("Android run lease process identity is invalid.");
  }
  return value;
}

function assertToken(value: string): string {
  if (!TOKEN_PATTERN.test(value)) {
    throw new TypeError("Android run lease token is invalid.");
  }
  return value;
}

function leaseToken(lease: NativeAndroidRunLease): string {
  if (!isRecord(lease) || typeof lease.token !== "string") {
    throw new TypeError("Android run lease identity is invalid.");
  }
  return assertToken(lease.token);
}

function assertLeaseRoot(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Android run lease root is invalid.");
  }
  const root = path.resolve(value);
  if (root === path.parse(root).root) {
    throw new TypeError(
      "Android run lease root cannot be the filesystem root.",
    );
  }
  return root;
}

function leaseDirectory(root: string, serial: string): string {
  const identity = createHash("sha256").update(serial).digest("hex");
  return path.join(root, identity);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJson(filePath: string): Promise<unknown | undefined> {
  let handle;
  try {
    handle = await open(
      filePath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    if (errorCode(error) === "ELOOP") {
      throw new TypeError("Android run lease metadata must be a real file.");
    }
    throw error;
  }
  let source: string;
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > MAX_LEASE_FILE_BYTES
    ) {
      throw new TypeError("Android run lease metadata is not a bounded file.");
    }
    if (
      process.platform !== "win32" &&
      ((metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" &&
          metadata.uid !== process.getuid()))
    ) {
      throw new TypeError(
        "Android run lease metadata must be private to the current user.",
      );
    }
    const buffer = Buffer.alloc(MAX_LEASE_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) {
      throw new TypeError("Android run lease metadata changed while read.");
    }
    source = buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new TypeError(
      `Android run lease metadata is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseOwner(value: unknown, serial: string): LeaseOwner {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 0 ||
    value.serial !== serial ||
    typeof value.token !== "string" ||
    typeof value.processId !== "number" ||
    typeof value.createdAtMilliseconds !== "number" ||
    !Number.isSafeInteger(value.createdAtMilliseconds) ||
    value.createdAtMilliseconds <= 0
  ) {
    throw new TypeError("Android run lease owner metadata is invalid.");
  }
  return {
    schemaVersion: 0,
    serial,
    token: assertToken(value.token),
    processId: assertProcessId(value.processId),
    createdAtMilliseconds: value.createdAtMilliseconds,
  };
}

function parseRestore(value: unknown, token: string): LeaseRestore {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 0 ||
    value.token !== token ||
    typeof value.originalStayAwake !== "string"
  ) {
    throw new TypeError("Android run lease restoration metadata is invalid.");
  }
  return {
    schemaVersion: 0,
    token,
    originalStayAwake: value.originalStayAwake,
  };
}

async function ensureLeaseRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError("Android run lease root must be a real directory.");
  }
  if (
    process.platform !== "win32" &&
    ((metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid()))
  ) {
    throw new TypeError(
      "Android run lease root must be private to the current user.",
    );
  }
}

async function assertLeaseDirectory(directory: string): Promise<number> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError(
      "Android run destination ownership must be a real directory.",
    );
  }
  if (
    process.platform !== "win32" &&
    ((metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid()))
  ) {
    throw new TypeError(
      "Android run destination ownership must be private to the current user.",
    );
  }
  return metadata.mtimeMs;
}

async function createLease(
  root: string,
  serial: string,
  dependency: NativeAndroidRunLeaseDependencies,
): Promise<NativeAndroidRunLease | undefined> {
  const directory = leaseDirectory(root, serial);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) === "EEXIST") return undefined;
    throw error;
  }
  try {
    const token = assertToken(dependency.randomToken());
    const createdAtMilliseconds = dependency.nowMilliseconds();
    if (
      !Number.isSafeInteger(createdAtMilliseconds) ||
      createdAtMilliseconds <= 0
    ) {
      throw new TypeError("Android run lease clock is invalid.");
    }
    const owner: LeaseOwner = {
      schemaVersion: 0,
      serial,
      token,
      processId: assertProcessId(dependency.processId),
      createdAtMilliseconds,
    };
    await writeFile(
      path.join(directory, OWNER_FILE),
      `${JSON.stringify(owner)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return { token };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function removeIncompleteLease(
  directory: string,
  root: string,
  dependency: NativeAndroidRunLeaseDependencies,
): Promise<boolean> {
  let modifiedAtMilliseconds: number;
  try {
    modifiedAtMilliseconds = await assertLeaseDirectory(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
  const age = dependency.nowMilliseconds() - modifiedAtMilliseconds;
  if (!Number.isFinite(age) || age < INCOMPLETE_LEASE_GRACE_MS) {
    throw new TypeError(
      "Android run destination ownership is being initialized by another process. Retry after the 30-second incomplete-lease recovery window.",
    );
  }
  const restoreMetadata = await readBoundedJson(
    path.join(directory, RESTORE_FILE),
  );
  if (restoreMetadata !== undefined) {
    throw new TypeError(
      `A stale Android run lease has restoration metadata but no valid owner at ${directory}; inspect it before changing the device setting.`,
    );
  }
  const quarantine = `${directory}.stale-${assertToken(dependency.randomToken())}`;
  try {
    await rename(directory, quarantine);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
  if (path.dirname(quarantine) !== root) {
    throw new TypeError("Android run lease quarantine escaped its root.");
  }
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

export async function acquireNativeAndroidRunLease(
  serial: string,
  recoverStayAwake: (originalStayAwake: string) => Promise<void>,
  overrides?: Partial<NativeAndroidRunLeaseDependencies>,
): Promise<NativeAndroidRunLease> {
  const dependency = dependencies(overrides);
  const root = assertLeaseRoot(dependency.leaseRoot);
  await ensureLeaseRoot(root);
  const directory = leaseDirectory(root, serial);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const created = await createLease(root, serial, dependency);
    if (created !== undefined) return created;

    try {
      await assertLeaseDirectory(directory);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }

    let ownerValue: unknown | undefined;
    try {
      ownerValue = await readBoundedJson(path.join(directory, OWNER_FILE));
    } catch (error) {
      if (
        error instanceof TypeError &&
        (await removeIncompleteLease(directory, root, dependency))
      ) {
        continue;
      }
      throw error;
    }
    if (ownerValue === undefined) {
      if (await removeIncompleteLease(directory, root, dependency)) continue;
      continue;
    }

    let owner: LeaseOwner;
    try {
      owner = parseOwner(ownerValue, serial);
    } catch (error) {
      if (await removeIncompleteLease(directory, root, dependency)) continue;
      throw error;
    }
    if (dependency.isProcessAlive(owner.processId)) {
      throw new TypeError(
        `Android device ${serial} is already owned by Solid Native process ${String(owner.processId)}. Wait for that run to finish before starting another one.`,
      );
    }

    const restoreValue = await readBoundedJson(
      path.join(directory, RESTORE_FILE),
    );
    if (restoreValue !== undefined) {
      const restore = parseRestore(restoreValue, owner.token);
      await recoverStayAwake(restore.originalStayAwake);
    }

    const quarantine = `${directory}.stale-${assertToken(dependency.randomToken())}`;
    try {
      await rename(directory, quarantine);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
    await rm(quarantine, { recursive: true, force: true });
  }
  throw new TypeError(
    `Android device ${serial} ownership changed repeatedly during preflight. Retry after the other run exits.`,
  );
}

export async function prepareNativeAndroidRunLease(
  serial: string,
  lease: NativeAndroidRunLease,
  originalStayAwake: string,
  overrides?: Partial<NativeAndroidRunLeaseDependencies>,
): Promise<void> {
  const dependency = dependencies(overrides);
  const root = assertLeaseRoot(dependency.leaseRoot);
  const directory = leaseDirectory(root, serial);
  await assertNativeAndroidRunLease(serial, lease, overrides);
  const restore: LeaseRestore = {
    schemaVersion: 0,
    token: leaseToken(lease),
    originalStayAwake,
  };
  await writeFile(
    path.join(directory, RESTORE_FILE),
    `${JSON.stringify(restore)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

export async function assertNativeAndroidRunLease(
  serial: string,
  lease: NativeAndroidRunLease,
  overrides?: Partial<NativeAndroidRunLeaseDependencies>,
): Promise<void> {
  const dependency = dependencies(overrides);
  const root = assertLeaseRoot(dependency.leaseRoot);
  const ownerValue = await readBoundedJson(
    path.join(leaseDirectory(root, serial), OWNER_FILE),
  );
  const owner = parseOwner(ownerValue, serial);
  if (
    owner.token !== leaseToken(lease) ||
    owner.processId !== assertProcessId(dependency.processId)
  ) {
    throw new TypeError(
      `Android device ${serial} run lease is no longer owned by this process.`,
    );
  }
}

export async function releaseNativeAndroidRunLease(
  serial: string,
  lease: NativeAndroidRunLease,
  overrides?: Partial<NativeAndroidRunLeaseDependencies>,
): Promise<void> {
  const dependency = dependencies(overrides);
  const root = assertLeaseRoot(dependency.leaseRoot);
  await assertNativeAndroidRunLease(serial, lease, overrides);
  await rm(leaseDirectory(root, serial), { recursive: true, force: false });
}
