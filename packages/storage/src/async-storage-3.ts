import { createKeyValueStorage, type KeyValueStorage } from "./index.js";

export interface AsyncStorage3NativeEntry {
  readonly key: string;
  readonly value: string | null;
}

/** The narrow AsyncStorage 3.x native ABI consumed by this adapter. */
export interface AsyncStorage3NativeModule {
  readonly getValues: (
    databaseName: string,
    keys: ReadonlyArray<string>,
  ) => Promise<unknown>;
  readonly setValues: (
    databaseName: string,
    entries: ReadonlyArray<AsyncStorage3NativeEntry>,
  ) => Promise<unknown>;
  readonly removeValues: (
    databaseName: string,
    keys: ReadonlyArray<string>,
  ) => Promise<unknown>;
}

export interface AsyncStorage3KeyValueStorageOptions {
  /** Selects one AsyncStorage 3.x SQLite database. */
  readonly databaseName: string;
  /** Prefixes keys within the selected database. */
  readonly prefix?: string;
}

function databaseName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.includes("\0")
  ) {
    throw new TypeError(
      "AsyncStorage database name must be a 1-128 character string without null bytes.",
    );
  }
  return value;
}

function nativeMethod(
  native: AsyncStorage3NativeModule,
  name: keyof AsyncStorage3NativeModule,
): void {
  if (typeof native[name] !== "function") {
    throw new TypeError(
      `AsyncStorage 3 native module ${name} must be a function.`,
    );
  }
}

function decodedValue(value: unknown, expectedKey: string): string | null {
  if (!Array.isArray(value) || value.length > 1) {
    throw new TypeError(
      "AsyncStorage 3 getValues must return at most one entry for one requested key.",
    );
  }
  if (value.length === 0) return null;
  const entry: unknown = value[0];
  if (
    typeof entry !== "object" ||
    entry === null ||
    Array.isArray(entry) ||
    !("key" in entry) ||
    !("value" in entry)
  ) {
    throw new TypeError("AsyncStorage 3 getValues returned a malformed entry.");
  }
  const candidate = entry as Readonly<Record<"key" | "value", unknown>>;
  if (
    candidate.key !== expectedKey ||
    (candidate.value !== null && typeof candidate.value !== "string")
  ) {
    throw new TypeError(
      "AsyncStorage 3 getValues returned an entry outside the requested string contract.",
    );
  }
  return candidate.value;
}

/**
 * Narrows an injected AsyncStorage 3.x TurboModule to portable string storage.
 * This entry point never evaluates the dependency's React-facing wrapper.
 */
export function createAsyncStorage3KeyValueStorage(
  native: AsyncStorage3NativeModule,
  options: AsyncStorage3KeyValueStorageOptions,
): KeyValueStorage {
  if (typeof native !== "object" || native === null) {
    throw new TypeError("AsyncStorage 3 native module must be an object.");
  }
  if (typeof options !== "object" || options === null) {
    throw new TypeError("AsyncStorage 3 adapter options must be an object.");
  }
  nativeMethod(native, "getValues");
  nativeMethod(native, "setValues");
  nativeMethod(native, "removeValues");
  const selectedDatabase = databaseName(options.databaseName);
  const getValues = native.getValues.bind(native);
  const setValues = native.setValues.bind(native);
  const removeValues = native.removeValues.bind(native);
  return createKeyValueStorage(
    {
      async getItem(key) {
        const result = await getValues(selectedDatabase, Object.freeze([key]));
        return decodedValue(result, key);
      },
      async setItem(key, value) {
        await setValues(
          selectedDatabase,
          Object.freeze([Object.freeze({ key, value })]),
        );
      },
      async removeItem(key) {
        await removeValues(selectedDatabase, Object.freeze([key]));
      },
    },
    {
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    },
  );
}
