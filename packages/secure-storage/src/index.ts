export const SECURE_STORAGE_MAX_KEY_LENGTH = 128;
export const SECURE_STORAGE_MAX_VALUE_LENGTH = 65_536;

export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SecureStorageAdapter {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

function secureKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SECURE_STORAGE_MAX_KEY_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `Secure-storage keys must be 1-${SECURE_STORAGE_MAX_KEY_LENGTH} character strings without null bytes.`,
    );
  }
  return value;
}

function secureValue(value: unknown, source: "application" | "native"): string {
  if (
    typeof value !== "string" ||
    value.length > SECURE_STORAGE_MAX_VALUE_LENGTH
  ) {
    throw new TypeError(
      `${source === "application" ? "Secure-storage values" : "The native secure-storage value"} must be a string of at most ${SECURE_STORAGE_MAX_VALUE_LENGTH} characters.`,
    );
  }
  return value;
}

function adapterMethod(
  adapter: SecureStorageAdapter,
  name: keyof SecureStorageAdapter,
): void {
  if (typeof adapter[name] !== "function") {
    throw new TypeError(`Secure-storage adapter ${name} must be a function.`);
  }
}

/**
 * Narrows an untrusted secure native adapter to bounded string credentials.
 * Operations are invoked in call order on each returned storage instance.
 */
export function createSecureStorage(
  adapter: SecureStorageAdapter,
): SecureStorage {
  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError("Secure-storage adapter must be an object.");
  }
  adapterMethod(adapter, "getItem");
  adapterMethod(adapter, "setItem");
  adapterMethod(adapter, "removeItem");
  const getItem = adapter.getItem.bind(adapter);
  const setItem = adapter.setItem.bind(adapter);
  const removeItem = adapter.removeItem.bind(adapter);
  let operations: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operations.then(operation);
    operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return Object.freeze({
    async getItem(key: string): Promise<string | null> {
      const selectedKey = secureKey(key);
      return await enqueue(async () => {
        const value = await getItem(selectedKey);
        return value === null ? null : secureValue(value, "native");
      });
    },
    async setItem(key: string, value: string): Promise<void> {
      const selectedKey = secureKey(key);
      const selectedValue = secureValue(value, "application");
      await enqueue(async () => {
        await setItem(selectedKey, selectedValue);
      });
    },
    async removeItem(key: string): Promise<void> {
      const selectedKey = secureKey(key);
      await enqueue(async () => {
        await removeItem(selectedKey);
      });
    },
  });
}
