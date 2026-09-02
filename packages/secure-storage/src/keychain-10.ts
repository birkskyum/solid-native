import { createSecureStorage, type SecureStorage } from "./index.js";

export const KEYCHAIN_10_MAX_SERVICE_PREFIX_LENGTH = 96;

const ACCOUNT = "solid-native.secure-storage/v1";
const ENCODED_VALUE_PREFIX = "solid-native:v1:";
const AUTHENTICATION_PROMPT = Object.freeze({
  cancel: "Cancel",
  title: "Authenticate to retrieve secret",
});

interface KeychainOptions {
  readonly accessible?: string;
  readonly authenticationPrompt: Readonly<{
    cancel: string;
    title: string;
  }>;
  readonly cloudSync: false;
  readonly securityLevel?: string;
  readonly service: string;
}

export interface ReactNativeKeychain10Module {
  setGenericPasswordForOptions(
    options: KeychainOptions,
    username: string,
    password: string,
  ): Promise<unknown>;
  getGenericPasswordForOptions(options: KeychainOptions): Promise<unknown>;
  resetGenericPasswordForOptions(options: KeychainOptions): Promise<unknown>;
}

export interface Keychain10SecureStorageOptions {
  /** Stable application-owned prefix used to isolate every native service. */
  readonly servicePrefix: string;
  /** iOS availability policy. Defaults to device-only access while unlocked. */
  readonly iosAccessibility?:
    "when-unlocked-device-only" | "after-first-unlock-device-only";
  /** Android Keystore floor. Hardware-backed storage can exclude some devices. */
  readonly androidSecurity?: "software" | "hardware";
}

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function servicePrefix(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KEYCHAIN_10_MAX_SERVICE_PREFIX_LENGTH ||
    value.includes("\0") ||
    value.endsWith(":")
  ) {
    throw new TypeError(
      `Keychain servicePrefix must be a 1-${KEYCHAIN_10_MAX_SERVICE_PREFIX_LENGTH} character string without null bytes or a trailing colon.`,
    );
  }
  return value;
}

function selectedAccessibility(
  value: Keychain10SecureStorageOptions["iosAccessibility"],
): string {
  if (value === undefined || value === "when-unlocked-device-only") {
    return "AccessibleWhenUnlockedThisDeviceOnly";
  }
  if (value === "after-first-unlock-device-only") {
    return "AccessibleAfterFirstUnlockThisDeviceOnly";
  }
  throw new TypeError(
    `Unsupported iOS secure-storage accessibility ${String(value)}.`,
  );
}

function selectedSecurity(
  value: Keychain10SecureStorageOptions["androidSecurity"],
): string {
  if (value === undefined || value === "software") return "SECURE_SOFTWARE";
  if (value === "hardware") return "SECURE_HARDWARE";
  throw new TypeError(
    `Unsupported Android secure-storage security ${String(value)}.`,
  );
}

function resultStorage(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.includes("\0")
  ) {
    throw new TypeError(`${path}.storage must be a bounded non-empty string.`);
  }
  return value;
}

function decodeMutationResult(value: unknown, expectedService: string): void {
  const result = record(value, "React Native Keychain 10 write result");
  if (result.service !== expectedService) {
    throw new TypeError(
      "React Native Keychain 10 wrote outside the requested service.",
    );
  }
  resultStorage(result.storage, "React Native Keychain 10 write result");
}

function decodeReadResult(
  value: unknown,
  expectedService: string,
): string | null {
  if (value === false) return null;
  const result = record(value, "React Native Keychain 10 read result");
  if (
    result.service !== expectedService ||
    result.username !== ACCOUNT ||
    typeof result.password !== "string" ||
    !result.password.startsWith(ENCODED_VALUE_PREFIX)
  ) {
    throw new TypeError(
      "React Native Keychain 10 returned credentials outside the requested storage contract.",
    );
  }
  resultStorage(result.storage, "React Native Keychain 10 read result");
  return result.password.slice(ENCODED_VALUE_PREFIX.length);
}

/**
 * Adapts react-native-keychain 10's exact legacy native ABI without evaluating
 * its React-facing JavaScript wrapper or runtime enums.
 */
export function createKeychain10SecureStorage(
  value: ReactNativeKeychain10Module,
  options: Keychain10SecureStorageOptions,
): SecureStorage {
  const module = record(value, "React Native Keychain 10 module");
  if (
    typeof module.setGenericPasswordForOptions !== "function" ||
    typeof module.getGenericPasswordForOptions !== "function" ||
    typeof module.resetGenericPasswordForOptions !== "function"
  ) {
    throw new TypeError(
      "React Native Keychain 10 module must provide the generic-password read, write, and reset methods.",
    );
  }
  if (typeof options !== "object" || options === null) {
    throw new TypeError("React Native Keychain 10 options must be an object.");
  }
  const prefix = servicePrefix(options.servicePrefix);
  const accessible = selectedAccessibility(options.iosAccessibility);
  const securityLevel = selectedSecurity(options.androidSecurity);
  const setGenericPasswordForOptions =
    value.setGenericPasswordForOptions.bind(value);
  const getGenericPasswordForOptions =
    value.getGenericPasswordForOptions.bind(value);
  const resetGenericPasswordForOptions =
    value.resetGenericPasswordForOptions.bind(value);
  // Keychain 10's React wrapper always supplies this prompt. Its iOS read ABI
  // inserts the prompt into an NSDictionary without accepting nil, even when
  // the credential has no access-control prompt. Reconstruct that required
  // normalization here without evaluating the React-facing wrapper.
  const nativeOptions = (key: string, mutation: boolean): KeychainOptions =>
    Object.freeze({
      ...(mutation ? { accessible, securityLevel } : {}),
      authenticationPrompt: AUTHENTICATION_PROMPT,
      cloudSync: false as const,
      service: `${prefix}:${key}`,
    });

  return createSecureStorage({
    async getItem(key) {
      const selectedOptions = nativeOptions(key, false);
      return decodeReadResult(
        await getGenericPasswordForOptions(selectedOptions),
        selectedOptions.service,
      );
    },
    async setItem(key, secret) {
      const selectedOptions = nativeOptions(key, true);
      decodeMutationResult(
        await setGenericPasswordForOptions(
          selectedOptions,
          ACCOUNT,
          `${ENCODED_VALUE_PREFIX}${secret}`,
        ),
        selectedOptions.service,
      );
    },
    async removeItem(key) {
      const selectedOptions = nativeOptions(key, false);
      const result = await resetGenericPasswordForOptions(selectedOptions);
      if (result !== true) {
        throw new TypeError(
          "React Native Keychain 10 reset did not confirm credential removal.",
        );
      }
    },
  });
}
