export type ReactNativePlatform = "android" | "ios";

export interface ReactNativeRuntimeVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export interface VerifiedReactNativeRelease {
  /** Exact npm release used by lockfiles, provenance, and build tooling. */
  readonly packageVersion: string;
  /** Normalized version exposed by PlatformConstants and the native JSI host. */
  readonly runtimeVersion: string;
  readonly runtimeVersionParts: ReactNativeRuntimeVersion;
  readonly hermesCompilerVersion: string;
  readonly hermesBytecodeVersion: number;
}

export interface VerifiedReactNativePlatform {
  readonly platform: ReactNativePlatform;
  readonly runtimeVersion: typeof REACT_NATIVE_0_87_RELEASE.runtimeVersion;
}

/**
 * The only React Native release currently supported by Solid Native.
 *
 * Package and runtime versions are separate even when their values match: a
 * nightly package has a prerelease suffix while PlatformConstants exposes only
 * its normalized major/minor/patch tuple.
 */
export const REACT_NATIVE_0_87_RELEASE = Object.freeze({
  packageVersion: "0.87.0",
  runtimeVersion: "0.87.0",
  runtimeVersionParts: Object.freeze({ major: 0, minor: 87, patch: 0 }),
  hermesCompilerVersion: "250829098.0.16",
  hermesBytecodeVersion: 98,
}) satisfies VerifiedReactNativeRelease;

function record(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function versionPart(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

/** Validates PlatformConstants against the supported normalized runtime. */
export function assertVerifiedReactNativePlatform(
  constantsValue: unknown,
  capability: string,
): VerifiedReactNativePlatform {
  const constants = record(constantsValue, "PlatformConstants");
  const version = record(
    constants.reactNativeVersion,
    "PlatformConstants.reactNativeVersion",
  );
  const observed = {
    major: versionPart(
      version.major,
      "PlatformConstants.reactNativeVersion.major",
    ),
    minor: versionPart(
      version.minor,
      "PlatformConstants.reactNativeVersion.minor",
    ),
    patch: versionPart(
      version.patch,
      "PlatformConstants.reactNativeVersion.patch",
    ),
  };
  const expected = REACT_NATIVE_0_87_RELEASE.runtimeVersionParts;
  if (
    observed.major !== expected.major ||
    observed.minor !== expected.minor ||
    observed.patch !== expected.patch
  ) {
    throw new Error(
      `${capability} is verified only with React Native runtime ${REACT_NATIVE_0_87_RELEASE.runtimeVersion}; received ${String(observed.major)}.${String(observed.minor)}.${String(observed.patch)}.`,
    );
  }

  let platform: ReactNativePlatform;
  if (typeof constants.Version === "number") {
    platform = "android";
  } else if (
    typeof constants.systemName === "string" &&
    constants.systemName.length > 0
  ) {
    platform = "ios";
  } else {
    throw new TypeError(
      "PlatformConstants did not identify an Android or iOS runtime.",
    );
  }

  return Object.freeze({
    platform,
    runtimeVersion: REACT_NATIVE_0_87_RELEASE.runtimeVersion,
  });
}
