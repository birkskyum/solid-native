export const KEY_VALUE_STORAGE_MAX_KEY_LENGTH = 1_024;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface KeyValueStorageAdapter {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

export interface KeyValueStorageOptions {
  /** Prefixes every adapter key so unrelated application data cannot collide. */
  readonly prefix?: string;
}

function storageKey(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KEY_VALUE_STORAGE_MAX_KEY_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must be a 1-${KEY_VALUE_STORAGE_MAX_KEY_LENGTH} character string without null bytes.`,
    );
  }
  return value;
}

function adapterMethod(
  adapter: KeyValueStorageAdapter,
  name: keyof KeyValueStorageAdapter,
): void {
  if (typeof adapter[name] !== "function") {
    throw new TypeError(
      `Key-value storage adapter ${name} must be a function.`,
    );
  }
}

/**
 * Narrows an untrusted native storage implementation to a small portable
 * string contract. Native failures remain rejected promises; malformed values
 * never enter application or restoration state.
 */
export function createKeyValueStorage(
  adapter: KeyValueStorageAdapter,
  options: KeyValueStorageOptions = {},
): KeyValueStorage {
  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError("Key-value storage adapter must be an object.");
  }
  adapterMethod(adapter, "getItem");
  adapterMethod(adapter, "setItem");
  adapterMethod(adapter, "removeItem");
  const prefix =
    options.prefix === undefined
      ? ""
      : `${storageKey(options.prefix, "Storage prefix")}:`;
  const resolveKey = (key: string): string =>
    `${prefix}${storageKey(key, "Storage key")}`;

  return Object.freeze({
    async getItem(key: string) {
      const value = await adapter.getItem(resolveKey(key));
      if (value !== null && typeof value !== "string") {
        throw new TypeError(
          "The native key-value storage adapter returned a non-string value.",
        );
      }
      return value;
    },
    async setItem(key: string, value: string) {
      if (typeof value !== "string") {
        throw new TypeError("Storage values must be strings.");
      }
      await adapter.setItem(resolveKey(key), value);
    },
    async removeItem(key: string) {
      await adapter.removeItem(resolveKey(key));
    },
  });
}
