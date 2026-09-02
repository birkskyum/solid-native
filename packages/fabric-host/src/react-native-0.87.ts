import { HOST_CONTRACT_VERSION } from "@solid-native/host-contract";
import { REACT_NATIVE_0_87_RELEASE } from "@solid-native/react-native-compat";

export type NativePlatform = "ios" | "android";
export type NativeBackendProof =
  | "device-verified"
  | "simulator-verified"
  | "compile-verified"
  | "research-only";

export interface NativeBackendFingerprint {
  readonly backend: string;
  readonly backendVersion: string;
  readonly platform: NativePlatform;
  readonly engine: string;
  readonly engineVersion: string;
  readonly hostContractVersion: number;
  readonly fabricEnabled: boolean;
}

export interface NativeBackendDefinition {
  readonly backend: "react-native-fabric";
  /** Exact React Native npm package release used to build this backend. */
  readonly packageVersion: string;
  /** Normalized runtime identity installed by the native host. */
  readonly backendVersion: string;
  readonly engine: "hermes";
  readonly engineVersion: string;
  readonly engineBytecodeVersion: number;
  readonly hostContractVersion: typeof HOST_CONTRACT_VERSION;
  readonly minimumIosVersion: string;
  readonly platformProof: Readonly<Record<NativePlatform, NativeBackendProof>>;
  readonly nativeApiSurface: readonly string[];
}

export interface NativeBackendValidationReport {
  readonly compatible: boolean;
  readonly issues: readonly string[];
  readonly proof: NativeBackendProof;
  readonly expected: NativeBackendDefinition;
  readonly observed: NativeBackendFingerprint;
}

/**
 * The only native backend line currently selected by the Fabric host.
 *
 * `device-verified` means the compatibility target compiled and linked, then
 * mounted, updated, measured, handled input, and tore down on real hardware.
 */
export const REACT_NATIVE_0_87_BACKEND = {
  backend: "react-native-fabric",
  packageVersion: REACT_NATIVE_0_87_RELEASE.packageVersion,
  backendVersion: REACT_NATIVE_0_87_RELEASE.runtimeVersion,
  engine: "hermes",
  engineVersion: REACT_NATIVE_0_87_RELEASE.hermesCompilerVersion,
  engineBytecodeVersion: REACT_NATIVE_0_87_RELEASE.hermesBytecodeVersion,
  hostContractVersion: HOST_CONTRACT_VERSION,
  minimumIosVersion: "15.1",
  platformProof: {
    ios: "device-verified",
    android: "device-verified",
  },
  nativeApiSurface: [
    "UIManager.createNode",
    "UIManager.cloneNode",
    "UIManager.appendChild",
    "UIManager.completeSurface",
    "UIManager.dispatchCommand",
  ],
} as const satisfies NativeBackendDefinition;

export class IncompatibleNativeBackendError extends Error {
  readonly report: NativeBackendValidationReport;

  constructor(report: NativeBackendValidationReport) {
    super(`Incompatible native backend: ${report.issues.join(" ")}`);
    this.name = "IncompatibleNativeBackendError";
    this.report = report;
  }
}

export function inspectNativeBackend(
  observed: NativeBackendFingerprint,
): NativeBackendValidationReport {
  const expected: NativeBackendDefinition = REACT_NATIVE_0_87_BACKEND;
  const proof = expected.platformProof[observed.platform];
  const issues: string[] = [];

  if (observed.backend !== expected.backend) {
    issues.push(
      `Expected backend ${expected.backend}, received ${observed.backend}.`,
    );
  }
  if (observed.backendVersion !== expected.backendVersion) {
    issues.push(
      `Expected React Native ${expected.backendVersion}, received ${observed.backendVersion}.`,
    );
  }
  if (observed.engine !== expected.engine) {
    issues.push(
      `Expected engine ${expected.engine}, received ${observed.engine}.`,
    );
  }
  if (observed.engineVersion !== expected.engineVersion) {
    issues.push(
      `Expected Hermes ${expected.engineVersion}, received ${observed.engineVersion}.`,
    );
  }
  if (observed.hostContractVersion !== expected.hostContractVersion) {
    issues.push(
      `Expected host contract ${expected.hostContractVersion}, received ${observed.hostContractVersion}.`,
    );
  }
  if (!observed.fabricEnabled) {
    issues.push("The React Native Fabric renderer is disabled.");
  }
  if (proof === "research-only") {
    issues.push(
      `The ${observed.platform} backend is ${proof}; no native runtime proof exists yet.`,
    );
  }

  return {
    compatible: issues.length === 0,
    issues,
    proof,
    expected,
    observed: { ...observed },
  };
}

export function assertCompatibleNativeBackend(
  observed: NativeBackendFingerprint,
): NativeBackendDefinition {
  const report = inspectNativeBackend(observed);
  if (!report.compatible) throw new IncompatibleNativeBackendError(report);
  return report.expected;
}
