import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  combineReactNativeCodegenSchemas,
  createSolidNativeSchemaAudit,
  generateSolidNativeBindingsModule,
  generateSolidNativeComponentModule,
  generateSolidNativeTurboModuleAdapterScaffold,
  generateSolidNativeTurboModuleBindings,
  type SolidNativeSchemaAudit,
} from "@solid-native/codegen";

import {
  formatNativeCompatibilityCatalogReport,
  parseNativeCompatibilityEvidence,
  parseNativeCompatibilityCatalog,
  verifyNativeCompatibilityCatalog,
  type NativeCompatibilityEvidence,
  type NativeCompatibilityCatalogReport,
} from "./compatibility-catalog.js";

import {
  SOLID_NATIVE_CLI_VERSION,
  VERIFIED_HERMES_BYTECODE_VERSION,
  VERIFIED_HERMES_COMPILER_VERSION,
  VERIFIED_REACT_NATIVE_PACKAGE_VERSION,
  VERIFIED_REACT_NATIVE_RUNTIME_VERSION,
  VERIFIED_REACT_NATIVE_VERSION,
  VERIFIED_SAFE_AREA_CONTEXT_VERSION,
  VERIFIED_SOLID_VERSION,
} from "./versions.js";
import { writeNativeBundleManifest } from "./bundle-artifacts.js";
import {
  canonicalizeNativeSourceMap,
  verifyNativeSourceMapPolicy,
  type NativeSourceMapPolicyReport,
} from "./source-map.js";
import {
  preflightNativeIosRunDestination,
  type NativeIosRunDestinationSelector,
  type NativeIosRunPreflight,
} from "./ios-run-preflight.js";
import {
  preflightNativeAndroidRunDestination,
  restoreNativeAndroidRunDestination,
  type NativeAndroidRunDestinationSelector,
  type NativeAndroidRunPreflight,
  type NativeAndroidRunPreflightDependencies,
  type NativeAndroidRunRestore,
  type NativeAndroidRunPreflightResult,
} from "./android-run-preflight.js";
import type { NativeTestExecutor, NativeTestPlan } from "./native-test.js";
import { inspectAndroidReleaseSigning } from "./android-release-signing.js";

export {
  NATIVE_TEST_MAX_FILE_COUNT,
  NATIVE_TEST_MAX_DIRECTORY_COUNT,
  NATIVE_TEST_MAX_DIRECTORY_ENTRY_COUNT,
  createNativeTestPlan,
  formatNativeTestPlan,
  type NativeTestDependencies,
  type NativeTestDirectoryEntry,
  type NativeTestExecutor,
  type NativeTestOptions,
  type NativeTestPlan,
  type NativeTestRuntime,
} from "./native-test.js";

export {
  createNativeAndroidDeviceProof,
  parseNativeAndroidBatteryState,
  parseNativeAndroidInstrumentationResult,
  type CreateNativeAndroidDeviceProofOptions,
  type CreateNativeAndroidDeviceProofResult,
  type NativeAndroidDeviceProofCommandResult,
  type NativeAndroidDeviceProofCommandRunner,
  type NativeAndroidDeviceProofDependencies,
} from "./android-device-proof.js";

export {
  defaultNativeAndroidBundleSigningCommandRunner,
  formatNativeAndroidBundleSigningReport,
  parseNativeAndroidBundleSigners,
  verifyNativeAndroidBundleSigning,
  type NativeAndroidBundleSigner,
  type NativeAndroidBundleSigningCheck,
  type NativeAndroidBundleSigningCommandResult,
  type NativeAndroidBundleSigningCommandRunner,
  type NativeAndroidBundleSigningReport,
  type VerifyNativeAndroidBundleSigningOptions,
} from "./android-bundle-signing.js";

export {
  defaultNativeAndroidApkSigningCommandRunner,
  formatNativeAndroidApkSigningReport,
  parseNativeAndroidApkSigners,
  resolveNativeAndroidApkSignerCommand,
  verifyNativeAndroidApkSigning,
  type NativeAndroidApkSigner,
  type NativeAndroidApkSigningCheck,
  type NativeAndroidApkSigningCommandResult,
  type NativeAndroidApkSigningCommandRunner,
  type NativeAndroidApkSigningReport,
  type VerifyNativeAndroidApkSigningOptions,
} from "./android-apk-signing.js";

export {
  createNativeAndroidLogsPlan,
  defaultNativeAndroidLogCommandRunner,
  defaultNativeAndroidLogsExecutor,
  executeNativeAndroidLogsPlan,
  formatNativeAndroidLogsPlan,
  parseAndroidPackageUid,
  parseAuthorizedAndroidDevices,
  type NativeAndroidLogCommandResult,
  type NativeAndroidLogCommandRunner,
  type NativeAndroidLogsDependencies,
  type NativeAndroidLogsExecutor,
  type NativeAndroidLogsOptions,
  type NativeAndroidLogsPlan,
} from "./android-logs.js";

export {
  createNativeIosLogsPlan,
  defaultNativeIosLogCommandRunner,
  defaultNativeIosLogsExecutor,
  executeNativeIosLogsPlan,
  formatNativeIosLogsPlan,
  parseNativeIosInstalledApplication,
  type NativeIosInstalledApplication,
  type NativeIosLogCommandResult,
  type NativeIosLogCommandRunner,
  type NativeIosLogsDependencies,
  type NativeIosLogsExecutor,
  type NativeIosLogsOptions,
  type NativeIosLogsPlan,
} from "./ios-logs.js";

export {
  defaultNativeIosProcessCommandRunner,
  formatNativeIosApplicationProcessStatus,
  formatNativeIosApplicationProcessStop,
  parseNativeIosApplicationProcesses,
  parseNativeIosProcessTarget,
  readNativeIosApplicationProcessStatus,
  stopNativeIosApplicationProcesses,
  type NativeIosApplicationProcessStatus,
  type NativeIosApplicationProcessStop,
  type NativeIosProcessApplication,
  type NativeIosProcessCommandResult,
  type NativeIosProcessCommandRunner,
  type NativeIosProcessDependencies,
  type NativeIosProcessOptions,
  type NativeIosProcessTarget,
} from "./ios-process.js";

export {
  parseNativeAndroidKeyguardShowing,
  preflightNativeAndroidRunDestination,
  restoreNativeAndroidRunDestination,
  type NativeAndroidRunDestinationSelector,
  type NativeAndroidRunLease,
  type NativeAndroidRunPreflight,
  type NativeAndroidRunPreflightDependencies,
  type NativeAndroidRunPreflightOptions,
  type NativeAndroidRunPreflightResult,
  type NativeAndroidRunRestore,
  type NativeAndroidRunRestoreOptions,
} from "./android-run-preflight.js";

export {
  parseNativeIosDeviceLockState,
  parseNativeIosSimulatorIdentifiers,
  preflightNativeIosRunDestination,
  type NativeIosDeviceLockState,
  type NativeIosRunDestinationSelector,
  type NativeIosRunPreflight,
  type NativeIosRunPreflightOptions,
  type NativeIosRunPreflightResult,
} from "./ios-run-preflight.js";

export {
  createNativeDeepLinkPlan,
  defaultNativeDeepLinkExecutor,
  executeNativeDeepLinkPlan,
  formatNativeDeepLinkPlan,
  parseNativeAndroidDeepLinkExecution,
  parseNativeIosDeepLinkExecution,
  type NativeAndroidDeepLinkExecution,
  type NativeAndroidDeepLinkOptions,
  type NativeAndroidDeepLinkPlan,
  type NativeDeepLinkCommandResult,
  type NativeDeepLinkCommandRunner,
  type NativeDeepLinkDependencies,
  type NativeDeepLinkExecution,
  type NativeDeepLinkExecutor,
  type NativeDeepLinkMode,
  type NativeDeepLinkOptions,
  type NativeDeepLinkPlan,
  type NativeIosDeepLinkExecution,
  type NativeIosDeepLinkOptions,
  type NativeIosDeepLinkPlan,
} from "./deep-link.js";

export {
  auditNativeReactNativeUpgrade,
  formatNativeReactNativeUpgradeReport,
  type NativeReactNativeBoundaryAudit,
  type NativeReactNativeHeaderDelta,
  type NativeReactNativeHeaderDeltaStatus,
  type NativeReactNativeQualificationGate,
  type NativeReactNativeUpgradeCheck,
  type NativeReactNativeUpgradeCheckStatus,
  type NativeReactNativeUpgradeDependencies,
  type NativeReactNativeUpgradeIdentity,
  type NativeReactNativeUpgradeOptions,
  type NativeReactNativeUpgradeReport,
} from "./react-native-upgrade.js";

export {
  VERIFIED_HERMES_BYTECODE_VERSION,
  VERIFIED_HERMES_COMPILER_VERSION,
  VERIFIED_REACT_NATIVE_PACKAGE_VERSION,
  VERIFIED_REACT_NATIVE_RUNTIME_VERSION,
  VERIFIED_REACT_NATIVE_VERSION,
  VERIFIED_SAFE_AREA_CONTEXT_VERSION,
  VERIFIED_SOLID_VERSION,
} from "./versions.js";
export {
  formatNativeCompatibilityCatalogReport,
  parseNativeCompatibilityEvidence,
  parseNativeCompatibilityCatalog,
  verifyNativeCompatibilityCatalog,
  type NativeCompatibilityCatalog,
  type NativeCompatibilityCatalogReport,
  type NativeCompatibilityCheckedClaim,
  type NativeCompatibilityClaim,
  type NativeCompatibilityClaimStatus,
  type NativeCompatibilityEvidence,
  type NativeCompatibilityEvidenceLevel,
  type NativeCompatibilityPackage,
  type NativeCompatibilityPlatform,
  type NativeCompatibilitySurfaceKind,
  type NativeCompatibilityUnclaimedSurface,
  type VerifyNativeCompatibilityCatalogOptions,
} from "./compatibility-catalog.js";
export {
  assembleNativeDeviceProofSignature,
  createNativeDeviceProofIngestion,
  createNativeDeviceProofSignature,
  createNativeDeviceProofSigningRequest,
  formatNativeDeviceProofIngestion,
  formatNativeDeviceProofSignatureVerification,
  inspectNativeDeviceProofProfile,
  nativeDeviceProofProfileFingerprint,
  nativeDeviceProofTrustPolicyFingerprint,
  parseNativeDeviceProofReceipt,
  readNativeDeviceProofReceipt,
  readNativeDeviceProofSignature,
  readNativeDeviceProofSigningRequest,
  readNativeDeviceProofTrustPolicy,
  verifyNativeDeviceProofSignature,
  type AssembleNativeDeviceProofSignatureOptions,
  type AssembleNativeDeviceProofSignatureResult,
  type CreateNativeDeviceProofIngestionOptions,
  type CreateNativeDeviceProofSignatureOptions,
  type CreateNativeDeviceProofSignatureResult,
  type CreateNativeDeviceProofSigningRequestOptions,
  type CreateNativeDeviceProofSigningRequestResult,
  type NativeAndroidDeviceProofReceipt,
  type NativeAndroidDeviceProofReceiptV0,
  type NativeAndroidDeviceProofReceiptV1,
  type NativeAuthenticatedDeviceProof,
  type NativeDeviceProofFileFact,
  type NativeDeviceProofIngestion,
  type NativeDeviceProofProfile,
  type NativeDeviceProofSignature,
  type NativeDeviceProofSignatureVerificationCheck,
  type NativeDeviceProofSignatureVerificationReport,
  type NativeDeviceProofSourcePolicyCheck,
  type NativeDeviceProofSourceMapFact,
  type NativeDeviceProofSigningRequest,
  type NativeDeviceProofTrustedKey,
  type NativeDeviceProofTrustPolicy,
  type NativeDeviceProofTrustPolicyV0,
  type NativeDeviceProofTrustPolicyV1,
  type NativeDeviceProofVerificationPolicy,
  type VerifyNativeDeviceProofSignatureOptions,
  type VerifyNativeDeviceProofSignatureWithPinnedKeyOptions,
  type VerifyNativeDeviceProofSignatureWithTrustPolicyOptions,
} from "./device-proof-signatures.js";
export {
  createNativeFingerprint,
  formatNativeFingerprint,
  type NativeFingerprintInput,
  type NativeFingerprintOptions,
  type NativeFingerprintPlatform,
  type NativeFingerprintReport,
  type NativeTargetFingerprint,
} from "./fingerprint.js";
export {
  canonicalizeNativeSourceMap,
  formatNativeSourceMapPolicyReport,
  validateCanonicalNativeSourceMap,
  verifyNativeSourceMapPolicy,
  type NativeSourceMapPolicyCheck,
  type NativeSourceMapPolicyReport,
  type VerifyNativeSourceMapPolicyOptions,
} from "./source-map.js";
export {
  formatNativeBundleVerification,
  readNativeBundleManifest,
  verifyNativeBundleManifest,
  writeNativeBundleManifest,
  type NativeBundleArtifact,
  type NativeBundleManifest,
  type NativeBundleVerificationCheck,
  type NativeBundleVerificationReport,
  type WriteNativeBundleManifestOptions,
} from "./bundle-artifacts.js";
export {
  createNativeReleaseManifest,
  formatNativeReleaseVerification,
  nativeReleaseFingerprintMatches,
  readNativeReleaseManifest,
  verifyNativeReleaseManifest,
  type CreateNativeReleaseOptions,
  type CreateNativeReleaseResult,
  type NativeReleaseArtifactSigning,
  type NativeReleaseDependencies,
  type NativeReleaseArtifact,
  type NativeReleaseManifest,
  type NativeReleaseVerificationCheck,
  type NativeReleaseVerificationReport,
  type VerifyNativeReleaseOptions,
} from "./release.js";
export {
  assembleNativeReleaseSignature,
  createNativeReleaseSignature,
  createNativeReleaseSigningRequest,
  formatNativeReleaseSignatureVerification,
  nativeReleaseTrustPolicyFingerprint,
  readNativeReleaseSigningRequest,
  readNativeReleaseTrustPolicy,
  verifyNativeReleaseSignature,
  type AssembleNativeReleaseSignatureOptions,
  type AssembleNativeReleaseSignatureResult,
  type CreateNativeReleaseSignatureOptions,
  type CreateNativeReleaseSignatureResult,
  type CreateNativeReleaseSigningRequestOptions,
  type CreateNativeReleaseSigningRequestResult,
  type NativeAuthorizedRelease,
  type NativeReleaseAuthorizationPolicy,
  type NativeReleaseSignature,
  type NativeReleaseSignatureVerificationCheck,
  type NativeReleaseSignatureVerificationReport,
  type NativeReleaseSigningRequest,
  type NativeReleaseTrustedKey,
  type NativeReleaseTrustPolicy,
  type VerifyNativeReleaseSignatureOptions,
  type VerifyNativeReleaseSignatureEnvelopeOnlyOptions,
  type VerifyNativeReleaseSignatureWithInputsOptions,
} from "./release-signatures.js";
export {
  createNativeSymbolicationHandoff,
  formatNativeSymbolicationHandoff,
  type CreateNativeSymbolicationHandoffOptions,
  type NativeSymbolicationArtifact,
  type NativeSymbolicationHandoff,
} from "./symbolication.js";
export {
  NATIVE_ANDROID_CAUSAL_DEBUG_DEFAULT_TIMEOUT_MS,
  NATIVE_ANDROID_CAUSAL_DEBUG_MAX_TIMEOUT_MS,
  NATIVE_ANDROID_CAUSAL_DEBUG_REQUEST_EVENT,
  NATIVE_ANDROID_SOLID_DIAGNOSTICS_DEFAULT_DURATION_MS,
  NATIVE_ANDROID_SOLID_DIAGNOSTICS_MAX_DURATION_MS,
  captureNativeAndroidCausalDebugSnapshot,
  captureNativeAndroidSolidDiagnostics,
  type CaptureNativeAndroidCausalDebugSnapshotOptions,
  type CaptureNativeAndroidSolidDiagnosticsOptions,
  type NativeAndroidCausalDebugCommandResult,
  type NativeAndroidCausalDebugCommandRunner,
  type NativeAndroidCausalDebugDependencies,
} from "./android-causal-debug.js";
export {
  NATIVE_SOLID_DIAGNOSTICS_CONTROL_KIND,
  NATIVE_SOLID_DIAGNOSTICS_CONTROL_SCHEMA_VERSION,
  parseNativeSolidDiagnosticsControlBytes,
  parseNativeSolidDiagnosticsDebugBytes,
  type NativeSolidDiagnosticsControl,
  type NativeSolidDiagnosticsOperation,
} from "./solid-diagnostics-debug.js";
export {
  NATIVE_SOLID_DIAGNOSTICS_INSPECTION_KIND,
  NATIVE_SOLID_DIAGNOSTICS_INSPECTION_MAX_RANKED_COSTS,
  NATIVE_SOLID_DIAGNOSTICS_INSPECTION_SCHEMA_VERSION,
  NATIVE_SOLID_DIAGNOSTICS_MAX_INPUT_CHUNKS,
  formatNativeSolidDiagnosticsInspection,
  inspectNativeSolidDiagnostics,
  inspectNativeSolidDiagnosticsFile,
  inspectNativeSolidDiagnosticsStream,
  type InspectNativeSolidDiagnosticsFileOptions,
  type NativeSolidDiagnosticsInputStream,
  type NativeSolidDiagnosticsInspection,
} from "./solid-diagnostics-inspection.js";
export {
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_KIND,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_MODE,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_SCHEMA_VERSION,
  NATIVE_SOLID_DIAGNOSTICS_CORRELATION_WINDOW_TOLERANCE_MS,
  correlateNativeSolidDiagnostics,
  correlateNativeSolidDiagnosticsFiles,
  formatNativeSolidDiagnosticsCorrelation,
  readNativeSolidDiagnosticsDebugFile,
  type CorrelateNativeSolidDiagnosticsFilesOptions,
  type CorrelateNativeSolidDiagnosticsOptions,
  type NativeSolidDiagnosticsCorrelatedOutput,
  type NativeSolidDiagnosticsCorrelation,
} from "./solid-diagnostics-correlation.js";
export {
  NATIVE_IOS_CAUSAL_DEBUG_DEFAULT_TIMEOUT_MS,
  NATIVE_IOS_CAUSAL_DEBUG_MIN_TIMEOUT_MS,
  NATIVE_IOS_CAUSAL_DEBUG_MAX_TIMEOUT_MS,
  NATIVE_IOS_CAUSAL_DEBUG_URL_SCHEME,
  NATIVE_IOS_SOLID_DIAGNOSTICS_DEFAULT_DURATION_MS,
  NATIVE_IOS_SOLID_DIAGNOSTICS_MAX_DURATION_MS,
  captureNativeIosCausalDebugSnapshot,
  captureNativeIosSolidDiagnostics,
  type CaptureNativeIosCausalDebugSnapshotOptions,
  type CaptureNativeIosSolidDiagnosticsOptions,
  type NativeIosCausalDebugCommandResult,
  type NativeIosCausalDebugCommandRunner,
  type NativeIosCausalDebugDependencies,
} from "./ios-causal-debug.js";
export {
  NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_INTERVAL_MS,
  NATIVE_CAUSAL_DEBUG_WATCH_DEFAULT_MAX_CONSECUTIVE_FAILURES,
  NATIVE_CAUSAL_DEBUG_WATCH_MAX_CONSECUTIVE_FAILURES,
  NATIVE_CAUSAL_DEBUG_WATCH_MAX_INTERVAL_MS,
  NATIVE_CAUSAL_DEBUG_WATCH_MAX_SNAPSHOT_COUNT,
  NATIVE_CAUSAL_DEBUG_WATCH_MIN_INTERVAL_MS,
  watchNativeCausalDebugSnapshots,
  type NativeCausalDebugWatchDependencies,
  type NativeCausalDebugWatchResult,
  type WatchNativeCausalDebugSnapshotsOptions,
} from "./causal-debug-watch.js";
export {
  NATIVE_CAUSAL_DEBUG_MAX_FILE_BYTES,
  NATIVE_CAUSAL_DEBUG_MAX_INPUT_BYTES,
  NATIVE_CAUSAL_TRACE_MAX_FLOW_COUNT,
  createNativeCausalTrace,
  createNativeCausalTraceFile,
  createNativeCausalTraceStream,
  formatNativeCausalDebugInspection,
  inspectNativeCausalDebugFile,
  inspectNativeCausalDebugSnapshot,
  inspectNativeCausalDebugStream,
  parseNativeCausalDebugSnapshotBytes,
  type CreateNativeCausalTraceFileOptions,
  type CreateNativeCausalTraceOptions,
  type InspectNativeCausalDebugFileOptions,
  type InspectNativeCausalDebugSnapshotOptions,
  type NativeCausalDebugInspection,
  type NativeCausalDebugGroupSummary,
  type NativeCausalDebugInputStream,
  type NativeCausalDebugOperationSummary,
  type NativeCausalDebugSelection,
  type NativeCausalTrace,
  type NativeCausalTraceArgument,
  type NativeCausalTraceArguments,
  type NativeCausalTraceCompleteEvent,
  type NativeCausalTraceEvent,
  type NativeCausalTraceFlowEvent,
  type NativeCausalTraceInstantEvent,
  type NativeCausalTraceMetadataEvent,
} from "./causal-debug.js";
export {
  NATIVE_CAUSAL_DEBUG_MAX_REPORT_BYTES,
  createNativeCausalDebugReport,
  createNativeCausalDebugReportFile,
  createNativeCausalDebugReportStream,
  writeNativeCausalDebugReportFile,
  type CreateNativeCausalDebugReportFileOptions,
  type CreateNativeCausalDebugReportOptions,
  type WriteNativeCausalDebugReportFileOptions,
} from "./causal-debug-report.js";
export {
  captureNativeAndroidCausalDebugReport,
  captureNativeIosCausalDebugReport,
  type CaptureNativeAndroidCausalDebugReportOptions,
  type CaptureNativeIosCausalDebugReportOptions,
  type NativeAndroidLiveCausalDebugReportDependencies,
  type NativeIosLiveCausalDebugReportDependencies,
} from "./live-causal-debug-report.js";
export {
  compareNativeCausalDebugFiles,
  compareNativeCausalDebugSnapshots,
  formatNativeCausalDebugComparison,
  type NativeCausalDebugComparison,
  type NativeCausalDebugComparisonFileOptions,
  type NativeCausalDebugComparisonOptions,
  type NativeCausalDebugComparisonSnapshotSummary,
  type NativeCausalDebugDurationDistribution,
  type NativeCausalDebugOperationComparison,
  type NativeCausalDebugRegression,
  type NativeCausalDebugRegressionMetric,
  type NativeCausalDebugStatusCounts,
} from "./causal-debug-compare.js";
export {
  NATIVE_SYMBOLICATION_MAX_LOCATIONS,
  formatNativeSourceLocationSymbolication,
  symbolicateNativeSourceLocations,
  type NativeGeneratedSourceLocation,
  type NativeOriginalSourceLocation,
  type NativeSourceLocationSymbolication,
  type NativeSymbolicatedSourceLocation,
  type SymbolicateNativeSourceLocationsOptions,
} from "./local-symbolication.js";
export {
  NATIVE_STACK_MAX_FRAMES,
  NATIVE_STACK_MAX_INPUT_BYTES,
  NATIVE_STACK_MAX_INPUT_CHUNKS,
  NATIVE_STACK_MAX_LINES,
  NATIVE_STACK_MAX_METHOD_NAME_CHARACTERS,
  NATIVE_STACK_MAX_SKIPPED_FRAMES,
  formatNativeStackTraceSymbolication,
  parseNativeStackTrace,
  symbolicateNativeStackTrace,
  symbolicateNativeStackTraceFile,
  symbolicateNativeStackTraceStream,
  type NativeParsedStackFrame,
  type NativeParsedStackTrace,
  type NativeStackTraceDialect,
  type NativeStackTraceInputStream,
  type NativeStackTraceSymbolication,
  type NativeSymbolicatedStackFrame,
  type SymbolicateNativeStackTraceFileOptions,
  type SymbolicateNativeStackTraceOptions,
  type SymbolicateNativeStackTraceStreamOptions,
} from "./stack-symbolication.js";
export {
  createNativeReleaseDeviceCorrelation,
  formatNativeReleaseDeviceCorrelation,
  type CreateNativeReleaseDeviceCorrelationOptions,
  type NativeReleaseDeviceCorrelation,
  type NativeReleaseDeviceCorrelationIdentity,
  type VerifyCorrelatedNativeDeviceProofOptions,
} from "./release-device-correlation.js";
export {
  inspectAndroidEmbeddedHermesBundle,
  type NativeEmbeddedBundleArtifact,
} from "./native-archive.js";

export { SOLID_NATIVE_CLI_VERSION } from "./versions.js";

export {
  createNativePackageAddPlan,
  defaultNativePackageAddExecutor,
  executeNativePackageAddPlan,
  formatNativePackageAddPlan,
  type NativePackageAddCapability,
  type NativePackageAddCommand,
  type NativePackageAddExecutor,
  type NativePackageAddOptions,
  type NativePackageAddPlan,
} from "./package-add.js";

export type DoctorPlatform = "all" | "android" | "ios";
export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";
export type NativeGeneratePlatform = DoctorPlatform;
export type NativeGenerateSource = "app" | "library";
export type NativeRunPlatform = "android" | "ios";
export type NativeBuildPlatform = NativeRunPlatform;
export type NativeBundlePlatform = NativeRunPlatform;

export interface NativeCreateCommand {
  readonly projectRoot: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface NativeCreatePlan extends NativeCreateCommand {
  readonly schemaVersion: 0;
  readonly operation: "create";
  readonly projectName: string;
  readonly packageName: string;
  readonly title: string;
  readonly targetDirectory: string;
  readonly packageManager: "pnpm@9.15.0";
  readonly installCommand?: NativeCreateCommand;
}

export interface NativeCreateOptions {
  readonly cwd?: string;
  readonly directory?: string;
  readonly packageName?: string;
  readonly projectName: string;
  readonly skipInstall?: boolean;
  readonly title?: string;
  readonly dependencies?: Readonly<{
    pathExists?: (target: string) => Promise<boolean>;
    reactNativeCommunityCli?: string;
  }>;
}

export type NativeCreateExecutor = (
  plan: NativeCreateCommand,
  context: {
    readonly env: NodeJS.ProcessEnv;
    readonly output: "inherit" | "quiet-on-success";
  },
) => Promise<number>;

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: DoctorCheckStatus;
  readonly message: string;
  readonly remediation?: string;
}

export interface DoctorSummary {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
  readonly skip: number;
}

export interface DoctorReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly projectRoot: string;
  readonly platform: DoctorPlatform;
  readonly checks: readonly DoctorCheck[];
  readonly summary: DoctorSummary;
}

export interface DoctorCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly errorCode?: string;
}

export type DoctorCommandRunner = (
  command: string,
  args: readonly string[],
  context: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
  },
) => Promise<DoctorCommandResult>;

export interface DoctorDependencies {
  readonly hostPlatform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly nodeVersion: string;
  readonly pathExists: (target: string) => Promise<boolean>;
  readonly readTextFile: (target: string) => Promise<string>;
  readonly runCommand: DoctorCommandRunner;
}

export interface DoctorOptions {
  readonly cwd?: string;
  readonly platform?: DoctorPlatform;
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<DoctorDependencies>;
}

export interface NativeRunPlan {
  readonly schemaVersion: 0;
  readonly operation: "run";
  readonly platform: NativeRunPlatform;
  readonly projectRoot: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly environmentDefaults?: Readonly<Record<string, string>>;
  readonly androidDestinationPreflight?: NativeAndroidRunDestinationSelector;
  readonly iosDestinationPreflight?: NativeIosRunDestinationSelector;
}

export interface NativeRunOptions {
  readonly cwd?: string;
  readonly platform: NativeRunPlatform;
  readonly forwardedArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: Partial<
    Pick<
      DoctorDependencies,
      "homeDirectory" | "hostPlatform" | "pathExists" | "readTextFile"
    >
  >;
}

export type NativeRunExecutor = (
  plan: NativeRunPlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

export interface NativeBuildPlan {
  readonly schemaVersion: 0;
  readonly operation: "build";
  readonly platform: NativeBuildPlatform;
  readonly projectRoot: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly environmentDefaults?: Readonly<Record<string, string>>;
}

export interface NativeBuildOptions {
  readonly cwd?: string;
  readonly platform: NativeBuildPlatform;
  readonly forwardedArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly dependencies?: NativeRunOptions["dependencies"];
}

export type NativeBuildExecutor = (
  plan: NativeBuildPlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

export interface NativeBundlePlan {
  readonly schemaVersion: 0;
  readonly operation: "bundle";
  readonly platform: NativeBundlePlatform;
  readonly projectRoot: string;
  readonly sourceRoot: string;
  readonly entryFile: string;
  readonly entryPoint: string;
  readonly outputDirectory: string;
  readonly bundlePath: string;
  readonly sourceMapPath: string;
  readonly assetsDirectory: string;
  readonly manifestPath: string;
  readonly minified: boolean;
  readonly hermesSource: boolean;
  readonly command: string;
  readonly args: readonly string[];
}

export interface NativeBundleOptions {
  readonly cwd?: string;
  readonly platform: NativeBundlePlatform;
  readonly entryFile?: string;
  readonly outputDirectory?: string;
  readonly hermesSource?: boolean;
  readonly forwardedArgs?: readonly string[];
  readonly dependencies?: NativeRunOptions["dependencies"];
}

export interface NativeBundleSourcePolicyOptions {
  readonly cwd?: string;
  readonly sourceMapPath: string;
  readonly requiredSources?: readonly string[];
  readonly forbiddenSourceFragments?: readonly string[];
  readonly dependencies?: NativeRunOptions["dependencies"];
}

export type NativeBundleExecutor = (
  plan: NativeBundlePlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

export interface NativeStartPlan {
  readonly schemaVersion: 0;
  readonly operation: "start";
  readonly projectRoot: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface NativeStartOptions {
  readonly cwd?: string;
  readonly forwardedArgs?: readonly string[];
  readonly dependencies?: NativeRunOptions["dependencies"];
}

export type NativeStartExecutor = (
  plan: NativeStartPlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

export interface NativeGeneratePlan {
  readonly schemaVersion: 0;
  readonly operation: "generate";
  readonly platform: NativeGeneratePlatform;
  readonly source: NativeGenerateSource;
  readonly projectRoot: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly outputPath: string;
  readonly solidBindings?: NativeSolidBindingGeneration;
}

export type NativeSolidBindingKind = "all" | "components" | "modules";

export interface NativeSolidBindingInput {
  readonly origin: "application" | "dependency";
  readonly kind: NativeSolidBindingKind;
  readonly libraryName: string;
  readonly packageName: string;
  readonly packageVersion?: string;
  readonly sourcePath: string;
}

export interface NativeSolidBindingGeneration {
  readonly kind: NativeSolidBindingKind;
  readonly inputs: readonly NativeSolidBindingInput[];
  readonly outputPath: string;
}

export type NativeSolidBindingCheckStatus =
  "match" | "missing" | "stale" | "unreadable";

export interface NativeSolidBindingCheckReport {
  readonly schemaVersion: 0;
  readonly ok: boolean;
  readonly outputPath: string;
  readonly status: NativeSolidBindingCheckStatus;
}

export interface NativeSolidBindingAuditReport extends SolidNativeSchemaAudit {
  readonly inputs: readonly Omit<NativeSolidBindingInput, "sourcePath">[];
}

export interface NativeCompatibilityCatalogOptions {
  readonly cwd?: string;
  readonly catalogPath?: string;
  readonly platform?: NativeGeneratePlatform;
  readonly dependencies?: Partial<NativeGenerateFileDependencies>;
}

export interface NativeCompatibilityEvidenceReport {
  readonly schemaVersion: 0;
  readonly projectRoot: string;
  readonly evidence: readonly NativeCompatibilityEvidence[];
}

export interface NativeCompatibilityEvidenceOptions {
  readonly cwd?: string;
  readonly paths: readonly string[];
  readonly dependencies?: Partial<NativeGenerateFileDependencies>;
}

export interface NativeAdapterScaffoldPlan {
  readonly schemaVersion: 0;
  readonly operation: "adapter-create";
  readonly platform: NativeGeneratePlatform;
  readonly projectRoot: string;
  readonly packageName: string;
  readonly packageVersion?: string;
  readonly libraryName: string;
  readonly moduleName: string;
  readonly outputPath: string;
  readonly bindingsImport: string;
  readonly bindingGeneration: NativeSolidBindingGeneration;
  readonly source: string;
}

export interface NativeAdapterScaffoldOptions {
  readonly cwd?: string;
  readonly platform?: NativeGeneratePlatform;
  readonly packageName: string;
  readonly moduleName: string;
  readonly outputPath?: string;
  readonly bindingsPath?: string;
  readonly dependencies?: Partial<NativeGenerateFileDependencies>;
}

export interface NativeGenerateOptions {
  readonly cwd?: string;
  readonly platform?: NativeGeneratePlatform;
  readonly source?: NativeGenerateSource;
  readonly outputPath?: string;
  readonly generateSolidBindings?: boolean;
  /** Direct dependencies whose installed Codegen specs join the Solid output. */
  readonly solidLibraries?: readonly string[];
  readonly solidOutputPath?: string;
  readonly verbose?: boolean;
  readonly dependencies?: Partial<NativeGenerateFileDependencies>;
}

export interface NativeGenerateFileDependencies extends Pick<
  DoctorDependencies,
  "pathExists" | "readTextFile"
> {
  readonly realPath: (target: string) => Promise<string>;
}

export type NativeGenerateExecutor = (
  plan: NativeGeneratePlan,
  context: { readonly env: NodeJS.ProcessEnv },
) => Promise<number>;

interface ProjectManifest {
  readonly name?: string;
  readonly version?: string;
  readonly packageManager?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly codegenConfig?: Readonly<Record<string, unknown>>;
}

interface NativeApplicationContext {
  readonly projectRoot: string;
  readonly reactNativeCli: string;
  readonly manifest: ProjectManifest;
}

interface NativeNavigationBackendContract {
  readonly schemaVersion: 1;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly reactNativeVersion: string;
  readonly patch: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly installedFiles: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

interface InstalledHermesCompatibility {
  readonly check: DoctorCheck;
  readonly compilerPath?: string;
  readonly compilerVersion?: string;
}

const COMMAND_TIMEOUT_MS = 8_000;
const MAX_COMMAND_OUTPUT = 64 * 1024;

function commandOutput(result: DoctorCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function check(
  id: string,
  label: string,
  status: DoctorCheckStatus,
  message: string,
  remediation?: string,
): DoctorCheck {
  return remediation === undefined
    ? { id, label, status, message }
    : { id, label, status, message, remediation };
}

function parseVersion(
  value: string,
): { readonly major: number; readonly minor: number } | undefined {
  const match = /^v?(\d+)\.(\d+)\.\d+(?:[-+].*)?$/u.exec(value.trim());
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor)
    ? { major, minor }
    : undefined;
}

function parseJavaMajor(value: string): number | undefined {
  const match = /version\s+"(\d+)(?:\.(\d+))?/u.exec(value);
  if (match === null) return undefined;
  const first = Number(match[1]);
  const major = first === 1 ? Number(match[2]) : first;
  return Number.isSafeInteger(major) ? major : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

function parseManifest(source: string): ProjectManifest {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) {
    throw new TypeError("package.json must contain an object.");
  }
  const name = typeof value.name === "string" ? value.name : undefined;
  const version = typeof value.version === "string" ? value.version : undefined;
  const packageManager =
    typeof value.packageManager === "string" ? value.packageManager : undefined;
  const dependencies = stringRecord(value.dependencies);
  const devDependencies = stringRecord(value.devDependencies);
  const peerDependencies = stringRecord(value.peerDependencies);
  const exports = isRecord(value.exports) ? value.exports : undefined;
  const codegenConfig = isRecord(value.codegenConfig)
    ? value.codegenConfig
    : undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version }),
    ...(packageManager === undefined ? {} : { packageManager }),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(devDependencies === undefined ? {} : { devDependencies }),
    ...(peerDependencies === undefined ? {} : { peerDependencies }),
    ...(exports === undefined ? {} : { exports }),
    ...(codegenConfig === undefined ? {} : { codegenConfig }),
  };
}

function declaredVersion(
  manifest: ProjectManifest,
  packageName: string,
): string | undefined {
  return (
    manifest.dependencies?.[packageName] ??
    manifest.devDependencies?.[packageName] ??
    manifest.peerDependencies?.[packageName]
  );
}

async function defaultPathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export const defaultDoctorCommandRunner: DoctorCommandRunner = (
  command,
  args,
  context,
) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, [...args], {
      cwd: context.cwd,
      env: context.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString("utf8")}`.slice(-MAX_COMMAND_OUTPUT);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const finish = (result: DoctorCommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, context.timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        ...(error.code === undefined ? {} : { errorCode: error.code }),
      });
    });
    child.on("close", (exitCode) => {
      finish({ exitCode, stdout, stderr, timedOut });
    });
  });

function defaultDependencies(): DoctorDependencies {
  return {
    hostPlatform: process.platform,
    homeDirectory: homedir(),
    nodeVersion: process.versions.node,
    pathExists: defaultPathExists,
    readTextFile: (target) => readFile(target, "utf8"),
    runCommand: defaultDoctorCommandRunner,
  };
}

function fileDependencies(
  overrides:
    NativeGenerateOptions["dependencies"] | NativeRunOptions["dependencies"],
): NativeGenerateFileDependencies {
  const realPathOverride =
    overrides !== undefined && "realPath" in overrides
      ? overrides.realPath
      : undefined;
  return {
    pathExists: overrides?.pathExists ?? defaultPathExists,
    readTextFile:
      overrides?.readTextFile ?? ((target) => readFile(target, "utf8")),
    realPath: realPathOverride ?? realpath,
  };
}

async function findProjectRoot(
  start: string,
  pathExists: DoctorDependencies["pathExists"],
): Promise<string | undefined> {
  let current = path.resolve(start);
  while (true) {
    if (await pathExists(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function findReactNativeCli(
  projectRoot: string,
  pathExists: DoctorDependencies["pathExists"],
): Promise<string | undefined> {
  let current = projectRoot;
  while (true) {
    const candidate = path.join(
      current,
      "node_modules",
      "react-native",
      "cli.js",
    );
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function findInstalledPackageManifest(
  projectRoot: string,
  packageName: string,
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<
  | {
      readonly path: string;
      readonly manifest: ProjectManifest;
    }
  | undefined
> {
  let current = projectRoot;
  while (true) {
    const candidate = path.join(
      current,
      "node_modules",
      packageName,
      "package.json",
    );
    if (await dependencies.pathExists(candidate)) {
      return {
        path: candidate,
        manifest: parseManifest(await dependencies.readTextFile(candidate)),
      };
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const NAVIGATION_BACKEND_EXPORT = "./react-native-screens-backend";
const MAX_NAVIGATION_BACKEND_CONTRACT_BYTES = 32 * 1024;
const MAX_NAVIGATION_BACKEND_FILES = 16;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function backendContractString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function backendContractSha256(value: unknown, label: string): string {
  const digest = backendContractString(value, label);
  if (!SHA256_PATTERN.test(digest)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function parseNativeNavigationBackendContract(
  source: string,
): NativeNavigationBackendContract {
  if (
    Buffer.byteLength(source, "utf8") > MAX_NAVIGATION_BACKEND_CONTRACT_BYTES
  ) {
    throw new TypeError("The navigation backend contract is too large.");
  }
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError("The navigation backend contract must use schema 1.");
  }
  const patch = value.patch;
  if (!isRecord(patch)) {
    throw new TypeError("The navigation backend contract patch is invalid.");
  }
  if (
    !Array.isArray(value.installedFiles) ||
    value.installedFiles.length === 0 ||
    value.installedFiles.length > MAX_NAVIGATION_BACKEND_FILES
  ) {
    throw new TypeError(
      `The navigation backend contract must contain 1-${String(MAX_NAVIGATION_BACKEND_FILES)} installed files.`,
    );
  }
  const seenPaths = new Set<string>();
  const installedFiles = value.installedFiles.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new TypeError(
        `Navigation backend installed file ${String(index)} is invalid.`,
      );
    }
    const filePath = backendContractString(
      entry.path,
      `Navigation backend installed file ${String(index)} path`,
    );
    if (seenPaths.has(filePath)) {
      throw new TypeError(
        `The navigation backend contract repeats installed file ${filePath}.`,
      );
    }
    seenPaths.add(filePath);
    return {
      path: filePath,
      sha256: backendContractSha256(
        entry.sha256,
        `Navigation backend installed file ${String(index)} digest`,
      ),
    };
  });
  return {
    schemaVersion: 1,
    packageName: backendContractString(
      value.packageName,
      "Navigation backend package name",
    ),
    packageVersion: backendContractString(
      value.packageVersion,
      "Navigation backend package version",
    ),
    reactNativeVersion: backendContractString(
      value.reactNativeVersion,
      "Navigation backend React Native version",
    ),
    patch: {
      path: backendContractString(patch.path, "Navigation backend patch path"),
      sha256: backendContractSha256(
        patch.sha256,
        "Navigation backend patch digest",
      ),
    },
    installedFiles,
  };
}

function resolvePackageContractPath(
  packageDirectory: string,
  relativePath: string,
  label: string,
): string {
  if (
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.includes("\0")
  ) {
    throw new TypeError(`${label} must be a portable package-relative path.`);
  }
  const target = path.resolve(packageDirectory, relativePath);
  const relative = path.relative(packageDirectory, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new TypeError(`${label} must remain inside its package.`);
  }
  return target;
}

function contentSha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function installedNavigationBackendCheck(
  projectRoot: string,
  manifest: ProjectManifest,
  reactNativeVersion: string | undefined,
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<DoctorCheck | undefined> {
  const navigationDeclaration = declaredVersion(
    manifest,
    "@solid-native/navigation",
  );
  if (navigationDeclaration === undefined) return undefined;

  try {
    const [navigation, screens] = await Promise.all([
      findInstalledPackageManifest(
        projectRoot,
        "@solid-native/navigation",
        dependencies,
      ),
      findInstalledPackageManifest(
        projectRoot,
        "react-native-screens",
        dependencies,
      ),
    ]);
    if (navigation === undefined || screens === undefined) {
      const missing = [
        ...(navigation === undefined ? ["@solid-native/navigation"] : []),
        ...(screens === undefined ? ["react-native-screens"] : []),
      ];
      return check(
        "project.navigation-backend",
        "Native navigation backend",
        "fail",
        `The declared ${missing.join(" and ")} package${missing.length === 1 ? " is" : "s are"} not installed.`,
        "Install the exact navigation peer set from the reviewed lockfile.",
      );
    }
    if (
      navigation.manifest.name !== "@solid-native/navigation" ||
      navigation.manifest.version === undefined
    ) {
      throw new TypeError(
        "The installed @solid-native/navigation manifest has an invalid name or version.",
      );
    }
    if (
      /^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(navigationDeclaration) &&
      navigation.manifest.version !== navigationDeclaration
    ) {
      throw new TypeError(
        `@solid-native/navigation declares ${navigationDeclaration} but ${navigation.manifest.version} is installed.`,
      );
    }

    const navigationDirectory = path.dirname(navigation.path);
    const backendExport =
      navigation.manifest.exports?.[NAVIGATION_BACKEND_EXPORT];
    if (typeof backendExport !== "string") {
      throw new TypeError(
        `Installed @solid-native/navigation does not expose ${NAVIGATION_BACKEND_EXPORT}.`,
      );
    }
    const contractPath = resolvePackageContractPath(
      navigationDirectory,
      backendExport,
      "Navigation backend export",
    );
    const contract = parseNativeNavigationBackendContract(
      await dependencies.readTextFile(contractPath),
    );
    if (
      contract.packageName !== "react-native-screens" ||
      screens.manifest.name !== contract.packageName ||
      screens.manifest.version !== contract.packageVersion
    ) {
      throw new TypeError(
        `Installed ${String(screens.manifest.name)} ${String(screens.manifest.version)} does not match ${contract.packageName} ${contract.packageVersion}.`,
      );
    }
    const screensDeclaration = declaredVersion(
      manifest,
      "react-native-screens",
    );
    if (screensDeclaration !== contract.packageVersion) {
      throw new TypeError(
        `react-native-screens must be declared as exact ${contract.packageVersion}, not ${String(screensDeclaration)}.`,
      );
    }
    if (reactNativeVersion !== contract.reactNativeVersion) {
      throw new TypeError(
        `The navigation backend requires React Native ${contract.reactNativeVersion}, not ${String(reactNativeVersion)}.`,
      );
    }

    const patchPath = resolvePackageContractPath(
      navigationDirectory,
      contract.patch.path,
      "Navigation backend patch",
    );
    const patchSource = await dependencies.readTextFile(patchPath);
    if (contentSha256(patchSource) !== contract.patch.sha256) {
      throw new TypeError(
        "The packaged navigation backend patch digest changed.",
      );
    }

    const screensDirectory = path.dirname(screens.path);
    for (const entry of contract.installedFiles) {
      const installedPath = resolvePackageContractPath(
        screensDirectory,
        entry.path,
        `Navigation backend installed file ${entry.path}`,
      );
      const installedSource = await dependencies.readTextFile(installedPath);
      if (contentSha256(installedSource) !== entry.sha256) {
        throw new TypeError(
          `Installed react-native-screens file ${entry.path} does not match the reviewed patched backend.`,
        );
      }
    }

    return check(
      "project.navigation-backend",
      "Native navigation backend",
      "pass",
      `Installed react-native-screens ${contract.packageVersion} matches all ${String(contract.installedFiles.length)} reviewed patched backend files.`,
    );
  } catch (error) {
    return check(
      "project.navigation-backend",
      "Native navigation backend",
      "fail",
      `Could not verify the installed navigation backend: ${errorMessage(error)}`,
      "Copy the patch exported by @solid-native/navigation/react-native-screens-patch into the application, configure the package manager to apply it to the exact peer version, reinstall, and rerun solid-native doctor.",
    );
  }
}

function hermesCompilerRelativePath(
  hostPlatform: NodeJS.Platform,
): string | undefined {
  switch (hostPlatform) {
    case "darwin":
      return path.join("hermesc", "osx-bin", "hermesc");
    case "linux":
      return path.join("hermesc", "linux64-bin", "hermesc");
    case "win32":
      return path.join("hermesc", "win64-bin", "hermesc.exe");
    default:
      return undefined;
  }
}

async function inspectInstalledHermesCompatibility(
  projectRoot: string,
  manifest: ProjectManifest,
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
  hostPlatform?: NodeJS.Platform,
): Promise<InstalledHermesCompatibility> {
  let reactNative;
  let compiler;
  try {
    [reactNative, compiler] = await Promise.all([
      findInstalledPackageManifest(projectRoot, "react-native", dependencies),
      findInstalledPackageManifest(
        projectRoot,
        "hermes-compiler",
        dependencies,
      ),
    ]);
  } catch (error) {
    return {
      check: check(
        "project.hermes-pair",
        "React Native/Hermes compiler pair",
        "fail",
        `Could not read the installed React Native/Hermes compiler pair: ${errorMessage(error)}`,
        "Reinstall dependencies from the reviewed lockfile before building the application.",
      ),
    };
  }
  if (reactNative === undefined || compiler === undefined) {
    const missing = [
      ...(reactNative === undefined ? ["react-native"] : []),
      ...(compiler === undefined ? ["hermes-compiler"] : []),
    ];
    return {
      check: check(
        "project.hermes-pair",
        "React Native/Hermes compiler pair",
        "fail",
        `The declared ${missing.join(" and ")} package${missing.length === 1 ? " is" : "s are"} not installed for this application.`,
        "Install dependencies from the reviewed lockfile before running native tooling.",
      ),
    };
  }

  const declaredReactNative = declaredVersion(manifest, "react-native");
  const declaredCompiler = declaredVersion(manifest, "hermes-compiler");
  const installedReactNative = reactNative.manifest.version;
  const installedCompiler = compiler.manifest.version;
  const requiredCompiler =
    reactNative.manifest.dependencies?.["hermes-compiler"];
  const problems: string[] = [];
  if (
    reactNative.manifest.name !== "react-native" ||
    installedReactNative === undefined
  ) {
    problems.push("the installed react-native manifest is invalid");
  } else if (installedReactNative !== declaredReactNative) {
    problems.push(
      `react-native declares ${String(declaredReactNative)} but ${installedReactNative} is installed`,
    );
  }
  if (
    compiler.manifest.name !== "hermes-compiler" ||
    installedCompiler === undefined
  ) {
    problems.push("the installed hermes-compiler manifest is invalid");
  } else if (installedCompiler !== declaredCompiler) {
    problems.push(
      `hermes-compiler declares ${String(declaredCompiler)} but ${installedCompiler} is installed`,
    );
  }
  if (requiredCompiler === undefined) {
    problems.push(
      `installed react-native ${String(installedReactNative)} does not pin hermes-compiler`,
    );
  } else if (requiredCompiler !== installedCompiler) {
    problems.push(
      `installed react-native ${String(installedReactNative)} requires hermes-compiler ${requiredCompiler} but the application resolves ${String(installedCompiler)}`,
    );
  }
  if (problems.length > 0) {
    return {
      check: check(
        "project.hermes-pair",
        "React Native/Hermes compiler pair",
        "fail",
        `${problems.join("; ")}.`,
        "Pin the exact hermes-compiler version declared by the installed react-native package, reinstall from the lockfile, and rerun solid-native doctor.",
      ),
    };
  }

  let compilerPath: string | undefined;
  if (hostPlatform !== undefined) {
    const relativeCompilerPath = hermesCompilerRelativePath(hostPlatform);
    if (relativeCompilerPath === undefined) {
      return {
        check: check(
          "project.hermes-pair",
          "React Native/Hermes compiler pair",
          "fail",
          `Solid Native cannot select hermesc on ${hostPlatform}.`,
          "Build on a supported macOS, Linux, or Windows host, or add a verified compiler mapping.",
        ),
      };
    }
    compilerPath = path.join(path.dirname(compiler.path), relativeCompilerPath);
    if (!(await dependencies.pathExists(compilerPath))) {
      return {
        check: check(
          "project.hermes-pair",
          "React Native/Hermes compiler pair",
          "fail",
          `Installed hermes-compiler ${String(installedCompiler)} does not contain the ${hostPlatform} compiler binary.`,
          "Reinstall the complete hermes-compiler artifact from the reviewed lockfile.",
        ),
      };
    }
  }

  return {
    check: check(
      "project.hermes-pair",
      "React Native/Hermes compiler pair",
      "pass",
      `Installed React Native ${String(installedReactNative)} requires and resolves hermes-compiler ${String(installedCompiler)}.`,
    ),
    ...(compilerPath === undefined ? {} : { compilerPath }),
    ...(installedCompiler === undefined
      ? {}
      : { compilerVersion: installedCompiler }),
  };
}

async function probeHermesBytecodeCompatibility(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  installed: InstalledHermesCompatibility,
  dependencies: DoctorDependencies,
): Promise<DoctorCheck> {
  if (
    installed.check.status !== "pass" ||
    installed.compilerPath === undefined ||
    installed.compilerVersion === undefined
  ) {
    return check(
      "project.hermes-bytecode",
      "Hermes bytecode contract",
      "skip",
      "The Hermes compiler cannot be probed until the installed React Native/compiler pair is valid.",
    );
  }
  const result = await runTool(
    dependencies,
    env,
    projectRoot,
    installed.compilerPath,
    ["-version"],
  );
  if (result.exitCode !== 0) {
    return commandFailure(
      "project.hermes-bytecode",
      "Hermes bytecode contract",
      "hermesc -version",
      result,
      "Reinstall the pinned hermes-compiler package before producing a native bundle.",
    );
  }
  const output = commandOutput(result);
  const releaseVersion = /Hermes release version:\s*([^\s]+)/u.exec(
    output,
  )?.[1];
  const bytecodeText = /HBC bytecode version:\s*(\d+)/u.exec(output)?.[1];
  const bytecodeVersion =
    bytecodeText === undefined ? undefined : Number(bytecodeText);
  const problems: string[] = [];
  if (releaseVersion !== installed.compilerVersion) {
    problems.push(
      releaseVersion === undefined
        ? "hermesc did not report its release version"
        : `hermesc reports release ${releaseVersion}, not package ${installed.compilerVersion}`,
    );
  }
  if (bytecodeVersion !== VERIFIED_HERMES_BYTECODE_VERSION) {
    problems.push(
      bytecodeVersion === undefined
        ? "hermesc did not report its HBC bytecode version"
        : `hermesc emits HBC ${bytecodeVersion}, not device-verified HBC ${VERIFIED_HERMES_BYTECODE_VERSION}`,
    );
  }
  return problems.length === 0
    ? check(
        "project.hermes-bytecode",
        "Hermes bytecode contract",
        "pass",
        `hermesc ${installed.compilerVersion} emits the device-verified HBC ${VERIFIED_HERMES_BYTECODE_VERSION} format.`,
      )
    : check(
        "project.hermes-bytecode",
        "Hermes bytecode contract",
        "fail",
        `${problems.join("; ")}.`,
        "Use the exact compiler/runtime pair in the supported Solid Native backend matrix; a mismatched HBC bundle aborts at application launch.",
      );
}

async function installedSolidNativePackagesCheck(
  projectRoot: string,
  platform: DoctorPlatform,
  declarations: {
    readonly core: string | undefined;
    readonly fabricHost: string | undefined;
    readonly runtime: string | undefined;
  },
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<DoctorCheck> {
  if (
    declarations.core === undefined ||
    declarations.fabricHost === undefined ||
    declarations.runtime === undefined
  ) {
    return check(
      "project.solid-native-installation",
      "Installed Solid Native packages",
      "skip",
      "The installed package set cannot be checked without all three declarations.",
    );
  }
  let core;
  let fabricHost;
  let runtime;
  try {
    [core, fabricHost, runtime] = await Promise.all([
      findInstalledPackageManifest(
        projectRoot,
        "@solid-native/core",
        dependencies,
      ),
      findInstalledPackageManifest(
        projectRoot,
        "@solid-native/fabric-host",
        dependencies,
      ),
      findInstalledPackageManifest(
        projectRoot,
        "@solid-native/runtime",
        dependencies,
      ),
    ]);
  } catch (error) {
    return check(
      "project.solid-native-installation",
      "Installed Solid Native packages",
      "fail",
      `Could not read the installed Solid Native package set: ${errorMessage(error)}`,
      "Reinstall dependencies from the lockfile and rerun solid-native doctor.",
    );
  }
  if (core === undefined || fabricHost === undefined || runtime === undefined) {
    const missing = [
      ...(core === undefined ? ["@solid-native/core"] : []),
      ...(fabricHost === undefined ? ["@solid-native/fabric-host"] : []),
      ...(runtime === undefined ? ["@solid-native/runtime"] : []),
    ];
    return check(
      "project.solid-native-installation",
      "Installed Solid Native packages",
      "fail",
      `The declared ${missing.join(" and ")} package${missing.length === 1 ? " is" : "s are"} not installed for this application.`,
      "Install dependencies from the lockfile before running native tooling.",
    );
  }
  if (
    core.manifest.name !== "@solid-native/core" ||
    fabricHost.manifest.name !== "@solid-native/fabric-host" ||
    runtime.manifest.name !== "@solid-native/runtime" ||
    core.manifest.version === undefined ||
    fabricHost.manifest.version === undefined ||
    runtime.manifest.version === undefined
  ) {
    return check(
      "project.solid-native-installation",
      "Installed Solid Native packages",
      "fail",
      "An installed Solid Native package has an invalid name or version.",
      "Remove node_modules and reinstall the reviewed package artifacts from the lockfile.",
    );
  }
  if (
    core.manifest.version !== fabricHost.manifest.version ||
    core.manifest.version !== runtime.manifest.version
  ) {
    return check(
      "project.solid-native-installation",
      "Installed Solid Native packages",
      "fail",
      `Installed @solid-native/core ${core.manifest.version}, @solid-native/fabric-host ${fabricHost.manifest.version}, and @solid-native/runtime ${runtime.manifest.version} do not match.`,
      "Install matching Solid Native core, Fabric Host, and runtime releases.",
    );
  }
  for (const [declaration, installed, packageName] of [
    [declarations.core, core.manifest.version, "@solid-native/core"],
    [
      declarations.fabricHost,
      fabricHost.manifest.version,
      "@solid-native/fabric-host",
    ],
    [declarations.runtime, runtime.manifest.version, "@solid-native/runtime"],
  ] as const) {
    if (
      /^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(declaration) &&
      declaration !== installed
    ) {
      return check(
        "project.solid-native-installation",
        "Installed Solid Native packages",
        "fail",
        `${packageName} declares ${declaration} but ${installed} is installed.`,
        "Reinstall dependencies from the lockfile or correct the exact package declaration.",
      );
    }
  }

  const requiredExports = [
    ...(platform === "all" || platform === "android"
      ? (["./android-gradle"] as const)
      : []),
    ...(platform === "all" || platform === "ios"
      ? (["./ios-podspec"] as const)
      : []),
    "./react-native-boundary" as const,
  ];
  const fabricHostDirectory = path.dirname(fabricHost.path);
  for (const exportName of requiredExports) {
    const target = fabricHost.manifest.exports?.[exportName];
    if (typeof target !== "string" || !target.startsWith("./")) {
      return check(
        "project.solid-native-installation",
        "Installed Solid Native packages",
        "fail",
        `Installed @solid-native/fabric-host ${fabricHost.manifest.version} does not expose ${exportName}.`,
        "Install the complete device-verified Fabric Host artifact for the selected platform.",
      );
    }
    const resolvedTarget = path.resolve(fabricHostDirectory, target);
    const relativeTarget = path.relative(fabricHostDirectory, resolvedTarget);
    if (
      relativeTarget === "" ||
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${path.sep}`) ||
      !(await dependencies.pathExists(resolvedTarget))
    ) {
      return check(
        "project.solid-native-installation",
        "Installed Solid Native packages",
        "fail",
        `Installed @solid-native/fabric-host ${fabricHost.manifest.version} has an invalid or missing ${exportName} target.`,
        "Reinstall the complete Fabric Host artifact from the reviewed lockfile.",
      );
    }
  }

  const boundaryTarget = fabricHost.manifest.exports?.[
    "./react-native-boundary"
  ] as string;
  let boundary: unknown;
  try {
    boundary = JSON.parse(
      await dependencies.readTextFile(
        path.resolve(fabricHostDirectory, boundaryTarget),
      ),
    );
  } catch {
    return check(
      "project.solid-native-installation",
      "Installed Solid Native packages",
      "fail",
      `Installed @solid-native/fabric-host ${fabricHost.manifest.version} has an unreadable React Native boundary manifest.`,
      "Reinstall the complete device-verified Fabric Host artifact from the reviewed lockfile.",
    );
  }
  const boundaryRecord =
    boundary !== null &&
    typeof boundary === "object" &&
    !Array.isArray(boundary)
      ? (boundary as Record<string, unknown>)
      : undefined;
  const boundaryAndroidCmake = boundaryRecord?.androidCmake;
  if (
    boundaryRecord === undefined ||
    boundaryRecord.schemaVersion !== 1 ||
    boundaryRecord.reactNativeVersion !==
      VERIFIED_REACT_NATIVE_PACKAGE_VERSION ||
    !Array.isArray(boundaryRecord.nativeHeaders) ||
    boundaryRecord.nativeHeaders.length === 0 ||
    !Array.isArray(boundaryRecord.generatedCodegenHeaders) ||
    !Array.isArray(boundaryRecord.androidImports) ||
    !Array.isArray(boundaryRecord.cocoapods) ||
    boundaryAndroidCmake === null ||
    typeof boundaryAndroidCmake !== "object" ||
    Array.isArray(boundaryAndroidCmake) ||
    !Array.isArray(
      (boundaryAndroidCmake as Record<string, unknown>)
        .reactNativeIncludeDirectories,
    ) ||
    (
      (boundaryAndroidCmake as Record<string, unknown>)
        .reactNativeIncludeDirectories as unknown[]
    ).length === 0 ||
    !Array.isArray(
      (boundaryAndroidCmake as Record<string, unknown>).inheritedCompileOptions,
    )
  ) {
    return check(
      "project.solid-native-installation",
      "Installed Solid Native packages",
      "fail",
      `Installed @solid-native/fabric-host ${fabricHost.manifest.version} does not contain the verified React Native ${VERIFIED_REACT_NATIVE_PACKAGE_VERSION} boundary inventory.`,
      "Install a Fabric Host release whose native boundary was reviewed with the selected React Native backend.",
    );
  }

  return check(
    "project.solid-native-installation",
    "Installed Solid Native packages",
    "pass",
    `Installed matching Solid Native ${runtime.manifest.version} core, Fabric Host, and runtime artifacts with the required native exports.`,
  );
}

async function resolveNativeApplication(
  cwd: string | undefined,
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<NativeApplicationContext> {
  const resolvedCwd = path.resolve(cwd ?? process.cwd());
  const projectRoot = await findProjectRoot(
    resolvedCwd,
    dependencies.pathExists,
  );
  if (projectRoot === undefined) {
    throw new TypeError(
      `No package.json was found at or above ${resolvedCwd}.`,
    );
  }
  let manifest: ProjectManifest;
  try {
    manifest = parseManifest(
      await dependencies.readTextFile(path.join(projectRoot, "package.json")),
    );
  } catch (error) {
    throw new TypeError(`Could not parse package.json: ${errorMessage(error)}`);
  }
  const reactNativeVersion = declaredVersion(manifest, "react-native");
  if (reactNativeVersion !== VERIFIED_REACT_NATIVE_VERSION) {
    throw new TypeError(
      reactNativeVersion === undefined
        ? "react-native is not declared in the application package.json."
        : `react-native is declared as ${reactNativeVersion}; only exact ${VERIFIED_REACT_NATIVE_VERSION} is device-verified.`,
    );
  }
  for (const packageName of [
    "@solid-native/core",
    "@solid-native/fabric-host",
    "@solid-native/runtime",
  ] as const) {
    if (declaredVersion(manifest, packageName) === undefined) {
      throw new TypeError(`${packageName} is not declared in package.json.`);
    }
  }
  const reactNativeCli = await findReactNativeCli(
    projectRoot,
    dependencies.pathExists,
  );
  if (reactNativeCli === undefined) {
    throw new TypeError(
      "Could not resolve the application-local react-native/cli.js. Install project dependencies before running native tooling.",
    );
  }
  return { projectRoot, reactNativeCli, manifest };
}

async function requireNativeDirectory(
  projectRoot: string,
  platform: NativeRunPlatform,
  pathExists: DoctorDependencies["pathExists"],
): Promise<void> {
  const nativeDirectory = path.join(projectRoot, platform);
  if (!(await pathExists(nativeDirectory))) {
    throw new TypeError(
      `The ${platform} native project is missing at ${nativeDirectory}.`,
    );
  }
}

async function findInheritedPackageManager(
  projectRoot: string,
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<{ readonly value: string; readonly source: string } | undefined> {
  let current = path.dirname(projectRoot);
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (await dependencies.pathExists(manifestPath)) {
      try {
        const manifest = parseManifest(
          await dependencies.readTextFile(manifestPath),
        );
        if (manifest.packageManager !== undefined) {
          return { value: manifest.packageManager, source: manifestPath };
        }
      } catch {
        // The nearest project manifest is reported separately. An unrelated
        // malformed ancestor must not hide diagnostics for the current app.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function commandFailure(
  id: string,
  label: string,
  command: string,
  result: DoctorCommandResult,
  remediation: string,
): DoctorCheck {
  if (result.timedOut) {
    return check(
      id,
      label,
      "fail",
      `${command} did not finish within ${COMMAND_TIMEOUT_MS / 1_000} seconds.`,
      remediation,
    );
  }
  const detail = firstLine(commandOutput(result));
  return check(
    id,
    label,
    "fail",
    detail.length === 0
      ? `${command} is unavailable or exited unsuccessfully.`
      : `${command} failed: ${detail}`,
    remediation,
  );
}

async function runTool(
  dependencies: DoctorDependencies,
  env: NodeJS.ProcessEnv,
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<DoctorCommandResult> {
  return dependencies.runCommand(command, args, {
    cwd,
    env,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
}

const IGNORED_NATIVE_SOURCE_DIRECTORIES = new Set([
  ".git",
  ".gradle",
  "Pods",
  "build",
  "DerivedData",
  "node_modules",
]);

async function findSourceMatching(
  directory: string,
  fileNames: ReadonlySet<string>,
  matches: (source: string) => boolean,
  dependencies: Pick<DoctorDependencies, "readTextFile">,
  depth = 0,
): Promise<string | undefined> {
  if (depth > 12) return undefined;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    if (!entry.isFile() || !fileNames.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    try {
      const source = await dependencies.readTextFile(target);
      if (matches(source)) return target;
    } catch {
      // A different readable candidate may still provide the integration.
    }
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      IGNORED_NATIVE_SOURCE_DIRECTORIES.has(entry.name)
    ) {
      continue;
    }
    const found = await findSourceMatching(
      path.join(directory, entry.name),
      fileNames,
      matches,
      dependencies,
      depth + 1,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

async function findNativeSourceWithTokens(
  directory: string,
  fileNames: ReadonlySet<string>,
  tokens: readonly string[],
  dependencies: Pick<DoctorDependencies, "readTextFile">,
): Promise<string | undefined> {
  return findSourceMatching(
    directory,
    fileNames,
    (source) => tokens.every((token) => source.includes(token)),
    dependencies,
  );
}

async function readFirstExistingFile(
  candidates: readonly string[],
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<{ readonly path: string; readonly source: string } | undefined> {
  for (const candidate of candidates) {
    if (!(await dependencies.pathExists(candidate))) continue;
    return {
      path: candidate,
      source: await dependencies.readTextFile(candidate),
    };
  }
  return undefined;
}

async function findAncestorFile(
  start: string,
  fileName: string,
  pathExists: DoctorDependencies["pathExists"],
): Promise<string | undefined> {
  let current = start;
  while (true) {
    const candidate = path.join(current, fileName);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function javascriptApplicationChecks(
  projectRoot: string,
  manifest: ProjectManifest,
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const solidVersion = declaredVersion(manifest, "solid-js");
  checks.push(
    solidVersion === VERIFIED_SOLID_VERSION
      ? check(
          "project.solid-runtime",
          "Solid runtime",
          "pass",
          `Solid is exactly pinned to the device-verified ${VERIFIED_SOLID_VERSION} runtime.`,
        )
      : check(
          "project.solid-runtime",
          "Solid runtime",
          "fail",
          solidVersion === undefined
            ? "solid-js is not declared by the application."
            : `solid-js is declared as ${solidVersion}; only exact ${VERIFIED_SOLID_VERSION} is device-verified.`,
          `Pin solid-js to exactly ${VERIFIED_SOLID_VERSION} so the compiler and runtime share one verified reactive implementation.`,
        ),
  );

  const buildToolExpectations = [
    ["@react-native/codegen", VERIFIED_REACT_NATIVE_VERSION],
    ["@react-native/gradle-plugin", VERIFIED_REACT_NATIVE_VERSION],
    ["hermes-compiler", VERIFIED_HERMES_COMPILER_VERSION],
  ] as const;
  const buildToolProblems = buildToolExpectations.flatMap(
    ([packageName, expected]) => {
      const declaration = declaredVersion(manifest, packageName);
      return declaration === expected
        ? []
        : [
            declaration === undefined
              ? `${packageName} is missing`
              : `${packageName} is ${declaration}, expected ${expected}`,
          ];
    },
  );
  checks.push(
    buildToolProblems.length === 0
      ? check(
          "project.native-build-toolchain",
          "React Native build toolchain",
          "pass",
          "React Native Codegen, Gradle, and Hermes build tools are directly and exactly pinned.",
        )
      : check(
          "project.native-build-toolchain",
          "React Native build toolchain",
          "fail",
          `${buildToolProblems.join("; ")}.`,
          "Declare the exact React Native Codegen, Gradle plugin, and Hermes compiler versions required by the generated pnpm application.",
        ),
  );

  checks.push(
    (
      await inspectInstalledHermesCompatibility(
        projectRoot,
        manifest,
        dependencies,
      )
    ).check,
  );

  const metroProblems: string[] = [];
  const metroDeclaration = declaredVersion(manifest, "@solid-native/metro");
  if (metroDeclaration === undefined) {
    metroProblems.push("@solid-native/metro is not declared");
  }
  const metroConfig = await readFirstExistingFile(
    [
      path.join(projectRoot, "metro.config.js"),
      path.join(projectRoot, "metro.config.cjs"),
      path.join(projectRoot, "metro.config.mjs"),
    ],
    dependencies,
  );
  if (metroConfig === undefined) {
    metroProblems.push("no Metro configuration was found");
  } else if (
    !metroConfig.source.includes("solidNativeTransformWorkerPath") ||
    !metroConfig.source.includes("createSolidNativeMetroResolver") ||
    !metroConfig.source.includes("createSolidNativeFullReloadPattern") ||
    !metroConfig.source.includes("unstable_forceFullRefreshPatterns")
  ) {
    metroProblems.push(
      `${path.relative(projectRoot, metroConfig.path)} does not install the Solid OXC worker, resolver, and safe full-reload policy`,
    );
  }
  if (metroDeclaration !== undefined) {
    try {
      const installedMetro = await findInstalledPackageManifest(
        projectRoot,
        "@solid-native/metro",
        dependencies,
      );
      if (installedMetro === undefined) {
        metroProblems.push(
          "the declared @solid-native/metro package is not installed",
        );
      } else if (
        installedMetro.manifest.name !== "@solid-native/metro" ||
        installedMetro.manifest.version === undefined
      ) {
        metroProblems.push(
          "the installed @solid-native/metro manifest is invalid",
        );
      } else if (
        /^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(metroDeclaration) &&
        metroDeclaration !== installedMetro.manifest.version
      ) {
        metroProblems.push(
          `@solid-native/metro declares ${metroDeclaration} but ${installedMetro.manifest.version} is installed`,
        );
      }
    } catch (error) {
      metroProblems.push(
        `the installed @solid-native/metro package could not be read: ${errorMessage(error)}`,
      );
    }
  }
  const metroHealthy = metroProblems.length === 0 && metroConfig !== undefined;
  checks.push(
    metroHealthy
      ? check(
          "project.oxc-metro",
          "Solid OXC/Metro compiler",
          "pass",
          `The installed Solid Metro package owns the transform worker, resolver, and safe full-reload policy in ${path.relative(projectRoot, metroConfig.path)}.`,
        )
      : check(
          "project.oxc-metro",
          "Solid OXC/Metro compiler",
          "fail",
          `${metroProblems.join("; ")}.`,
          "Install @solid-native/metro and configure solidNativeTransformWorkerPath, createSolidNativeMetroResolver, and createSolidNativeFullReloadPattern through unstable_forceFullRefreshPatterns; Babel and React Refresh are not supported Solid compiler or lifecycle fallbacks.",
        ),
  );

  const bootstrap = await findSourceMatching(
    projectRoot,
    new Set([
      "index.js",
      "index.mjs",
      "index.ts",
      "index.tsx",
      "main.js",
      "main.mjs",
      "main.ts",
      "main.tsx",
    ]),
    (source) =>
      source.includes("@solid-native/runtime") &&
      (source.includes("startNativeApplication") ||
        (source.includes("createNativeFabricHost") &&
          source.includes("startApplication"))),
    dependencies,
  );
  checks.push(
    bootstrap === undefined
      ? check(
          "project.javascript-bootstrap",
          "Solid Native JavaScript bootstrap",
          "fail",
          "No application entrypoint starts the Solid renderer through @solid-native/runtime.",
          "Call startNativeApplication, or explicitly createNativeFabricHost and startApplication, from the application entrypoint.",
        )
      : check(
          "project.javascript-bootstrap",
          "Solid Native JavaScript bootstrap",
          "pass",
          `Found the Solid-owned application bootstrap in ${path.relative(projectRoot, bootstrap)}.`,
        ),
  );
  return checks;
}

async function androidChecks(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  dependencies: DoctorDependencies,
): Promise<readonly DoctorCheck[]> {
  const androidDirectory = path.join(projectRoot, "android");
  if (!(await dependencies.pathExists(androidDirectory))) {
    return [
      check(
        "android.project",
        "Android project",
        "skip",
        "No android directory exists in this project.",
      ),
    ];
  }

  const checks: DoctorCheck[] = [
    check(
      "android.project",
      "Android project",
      "pass",
      `Found ${androidDirectory}.`,
    ),
  ];
  const gradlePropertiesPath = path.join(androidDirectory, "gradle.properties");
  try {
    const gradleProperties =
      await dependencies.readTextFile(gradlePropertiesPath);
    for (const [id, label, property] of [
      ["android.fabric", "React Native new architecture", "newArchEnabled"],
      ["android.hermes", "Hermes", "hermesEnabled"],
    ] as const) {
      const enabled = new RegExp(`^${property}\\s*=\\s*true\\s*$`, "mu").test(
        gradleProperties,
      );
      checks.push(
        enabled
          ? check(id, label, "pass", `${property}=true.`)
          : check(
              id,
              label,
              "fail",
              `${property}=true is not set in android/gradle.properties.`,
              `Set ${property}=true; Solid Native's verified backend requires Fabric and Hermes.`,
            ),
      );
    }
  } catch (error) {
    checks.push(
      check(
        "android.configuration",
        "Android configuration",
        "fail",
        `Could not read android/gradle.properties: ${errorMessage(error)}`,
        "Restore the React Native Android project configuration.",
      ),
    );
  }

  const gradleWrapper = path.join(androidDirectory, "gradlew");
  checks.push(
    (await dependencies.pathExists(gradleWrapper))
      ? check(
          "android.gradle-wrapper",
          "Gradle wrapper",
          "pass",
          "Found android/gradlew.",
        )
      : check(
          "android.gradle-wrapper",
          "Gradle wrapper",
          "fail",
          "android/gradlew is missing.",
          "Regenerate or restore the checked-in Gradle wrapper.",
        ),
  );

  const applicationBuildCandidates = [
    path.join(androidDirectory, "app", "build.gradle"),
    path.join(androidDirectory, "app", "build.gradle.kts"),
  ];
  let applicationBuild:
    { readonly path: string; readonly source: string } | undefined;
  try {
    applicationBuild = await readFirstExistingFile(
      applicationBuildCandidates,
      dependencies,
    );
    checks.push(
      applicationBuild?.source.includes(
        "@solid-native/fabric-host/android-gradle",
      ) === true
        ? check(
            "android.runtime-gradle",
            "Solid Native Gradle integration",
            "pass",
            `The app resolves the package-owned Gradle helper from ${path.relative(projectRoot, applicationBuild.path)}.`,
          )
        : check(
            "android.runtime-gradle",
            "Solid Native Gradle integration",
            "fail",
            "The Android app does not apply @solid-native/fabric-host/android-gradle.",
            "Resolve @solid-native/fabric-host/android-gradle with Node and apply it after the Android application, Kotlin, and React Native plugins.",
          ),
    );
    if (applicationBuild === undefined) {
      checks.push(
        check(
          "android.release-signing",
          "Android Release signing",
          "skip",
          "No Android application build file is available to inspect.",
        ),
      );
    } else {
      const signing = inspectAndroidReleaseSigning(applicationBuild.source);
      const relativeBuildPath = path.relative(
        projectRoot,
        applicationBuild.path,
      );
      checks.push(
        signing.kind === "non-debug"
          ? check(
              "android.release-signing",
              "Android Release signing",
              "pass",
              `The Release build selects the explicit non-debug ${signing.names.map((name) => `signingConfigs.${name}`).join(", ")} configuration in ${relativeBuildPath}. Secret availability and Play App Signing remain delivery-pipeline responsibilities.`,
            )
          : signing.kind === "debug"
            ? check(
                "android.release-signing",
                "Android Release signing",
                "warn",
                `The Release build in ${relativeBuildPath} explicitly reuses signingConfigs.debug. Its AAB is suitable for local development, not Play distribution.`,
                "Create an app-owned non-debug signing configuration backed by a protected local or CI keystore, assign it to the Release build, and use Play App Signing. Do not commit private keys or credentials.",
              )
            : check(
                "android.release-signing",
                "Android Release signing",
                "warn",
                signing.kind === "ambiguous"
                  ? `The Release build in ${relativeBuildPath} can select both debug and non-debug signing configurations, so distribution intent is ambiguous.`
                  : `The Release build in ${relativeBuildPath} does not expose an explicit non-debug signing configuration that Solid Native can verify statically.`,
                "Assign an app-owned non-debug signing configuration to the Release build, inject its keystore credentials outside source control, and rerun solid-native doctor.",
              ),
      );
    }
  } catch (error) {
    checks.push(
      check(
        "android.runtime-gradle",
        "Solid Native Gradle integration",
        "fail",
        `Could not read the Android application build file: ${errorMessage(error)}`,
        "Restore android/app/build.gradle and apply @solid-native/fabric-host/android-gradle.",
      ),
      check(
        "android.release-signing",
        "Android Release signing",
        "skip",
        "Release signing could not be inspected because the Android application build file could not be read.",
      ),
    );
  }

  const cmakePath = path.join(
    androidDirectory,
    "app",
    "src",
    "main",
    "jni",
    "CMakeLists.txt",
  );
  try {
    const cmake = await dependencies.readTextFile(cmakePath);
    checks.push(
      cmake.includes("SolidNativeRuntime.cmake") &&
        cmake.includes("solid_native_configure_android_target")
        ? check(
            "android.runtime-cmake",
            "Solid Native CMake integration",
            "pass",
            "The application target includes and configures SolidNativeRuntime.cmake.",
          )
        : check(
            "android.runtime-cmake",
            "Solid Native CMake integration",
            "fail",
            "android/app/src/main/jni/CMakeLists.txt does not configure the Solid Native runtime target.",
            "Include SolidNativeRuntime.cmake and call solid_native_configure_android_target after React Native creates the application target.",
          ),
    );
  } catch (error) {
    checks.push(
      check(
        "android.runtime-cmake",
        "Solid Native CMake integration",
        "fail",
        `Could not read android/app/src/main/jni/CMakeLists.txt: ${errorMessage(error)}`,
        "Add the React Native application CMake entry point and configure SolidNativeRuntime.cmake.",
      ),
    );
  }

  const onLoadPath = path.join(
    androidDirectory,
    "app",
    "src",
    "main",
    "jni",
    "OnLoad.cpp",
  );
  try {
    const onLoad = await dependencies.readTextFile(onLoadPath);
    checks.push(
      onLoad.includes("registerSolidNativeBindingsInstaller")
        ? check(
            "android.runtime-jni",
            "Solid Native JNI registration",
            "pass",
            "JNI_OnLoad registers the Solid Native bindings installer.",
          )
        : check(
            "android.runtime-jni",
            "Solid Native JNI registration",
            "fail",
            "android/app/src/main/jni/OnLoad.cpp does not register the Solid Native bindings installer.",
            "Call solid_native::android::registerSolidNativeBindingsInstaller() from the fbjni initializer.",
          ),
    );
  } catch (error) {
    checks.push(
      check(
        "android.runtime-jni",
        "Solid Native JNI registration",
        "fail",
        `Could not read android/app/src/main/jni/OnLoad.cpp: ${errorMessage(error)}`,
        "Restore the React Native JNI entry point and register the Solid Native bindings installer.",
      ),
    );
  }

  const androidBootstrap = await findNativeSourceWithTokens(
    path.join(androidDirectory, "app", "src", "main"),
    new Set(["MainApplication.java", "MainApplication.kt"]),
    ["SolidNativeBindingsInstaller", "bindingsInstaller"],
    dependencies,
  );
  checks.push(
    androidBootstrap === undefined
      ? check(
          "android.runtime-bootstrap",
          "Solid Native Android bootstrap",
          "fail",
          "No MainApplication source passes SolidNativeBindingsInstaller to ReactHost.",
          "Construct the package-owned SolidNativeBindingsInstaller and pass it as ReactHost's bindingsInstaller.",
        )
      : check(
          "android.runtime-bootstrap",
          "Solid Native Android bootstrap",
          "pass",
          `Found the bindings installer bootstrap in ${path.relative(projectRoot, androidBootstrap)}.`,
        ),
  );

  const androidRuntimePackage = await findNativeSourceWithTokens(
    path.join(androidDirectory, "app", "src", "main"),
    new Set(["MainApplication.java", "MainApplication.kt"]),
    ["SolidNativePackage"],
    dependencies,
  );
  checks.push(
    androidRuntimePackage === undefined
      ? check(
          "android.runtime-package",
          "Solid Native Android package",
          "fail",
          "No MainApplication source registers SolidNativePackage with ReactHost.",
          "Add SolidNativePackage() to the package list so debuggable builds can expose the app-private one-shot tooling module.",
        )
      : check(
          "android.runtime-package",
          "Solid Native Android package",
          "pass",
          `Found the runtime package bootstrap in ${path.relative(projectRoot, androidRuntimePackage)}.`,
        ),
  );

  const androidMemoryPressure = await findNativeSourceWithTokens(
    path.join(androidDirectory, "app", "src", "main"),
    new Set(["MainApplication.java", "MainApplication.kt"]),
    ["SolidNativeMemoryWarning", "handleTrimMemory", "handleLowMemory"],
    dependencies,
  );
  checks.push(
    androidMemoryPressure === undefined
      ? check(
          "android.memory-pressure",
          "Solid Native Android memory pressure",
          "fail",
          "No MainApplication source forwards Android memory-pressure callbacks to Solid Native.",
          "Forward onTrimMemory and onLowMemory to SolidNativeMemoryWarning so Solid-owned cache policy can react.",
        )
      : check(
          "android.memory-pressure",
          "Solid Native Android memory pressure",
          "pass",
          `Found the memory-pressure lifecycle seam in ${path.relative(projectRoot, androidMemoryPressure)}.`,
        ),
  );

  const debugSpecPath = path.join(
    projectRoot,
    "specs",
    "NativeSolidNativeDebug.ts",
  );
  const platformSpecPath = path.join(
    projectRoot,
    "specs",
    "NativeSolidNativePlatformAndroid.ts",
  );
  try {
    const manifest = parseManifest(
      await dependencies.readTextFile(path.join(projectRoot, "package.json")),
    );
    const codegen = manifest.codegenConfig;
    const androidCodegen = isRecord(codegen?.android)
      ? codegen.android
      : undefined;
    const [debugSpec, platformSpec] = await Promise.all([
      dependencies.readTextFile(debugSpecPath),
      dependencies.readTextFile(platformSpecPath),
    ]);
    const compactDebugSpec = debugSpec.replaceAll(/\s/gu, "");
    const compactPlatformSpec = platformSpec.replaceAll(/\s/gu, "");
    const valid =
      (codegen?.type === "modules" || codegen?.type === "all") &&
      codegen.jsSrcsDir === "specs" &&
      androidCodegen?.javaPackageName === "dev.solidnative.runtime" &&
      debugSpec.includes("interface Spec extends TurboModule") &&
      compactDebugSpec.includes("operation:string") &&
      compactDebugSpec.includes("sessionId?:string") &&
      compactDebugSpec.includes(
        'TurboModuleRegistry.getEnforcing<Spec>("SolidNativeDebug"',
      ) &&
      platformSpec.includes("interface Spec extends TurboModule") &&
      platformSpec.includes("onMemoryWarning") &&
      compactPlatformSpec.includes(
        'TurboModuleRegistry.getEnforcing<Spec>("SolidNativePlatformAndroid"',
      );
    checks.push(
      valid
        ? check(
            "android.runtime-codegen",
            "Solid Native runtime TurboModule specs",
            "pass",
            "React Native Codegen owns the SolidNativeDebug and SolidNativePlatformAndroid TurboModule contracts.",
          )
        : check(
            "android.runtime-codegen",
            "Solid Native runtime TurboModule specs",
            "fail",
            "The Android application does not declare the complete Solid Native runtime Codegen contracts.",
            "Restore NativeSolidNativeDebug.ts and NativeSolidNativePlatformAndroid.ts through a modules/all codegenConfig using the dev.solidnative.runtime Java package.",
          ),
    );
  } catch (error) {
    checks.push(
      check(
        "android.runtime-codegen",
        "Solid Native runtime TurboModule specs",
        "fail",
        `Could not read the Solid Native runtime Codegen contracts: ${errorMessage(error)}`,
        "Restore specs/NativeSolidNativeDebug.ts, specs/NativeSolidNativePlatformAndroid.ts, and the scaffolded package.json codegenConfig.",
      ),
    );
  }

  const androidSurface = await findNativeSourceWithTokens(
    path.join(androidDirectory, "app", "src", "main"),
    new Set(["MainActivity.java", "MainActivity.kt"]),
    ["SolidNativeSurface", "SolidNativeSurface.start"],
    dependencies,
  );
  checks.push(
    androidSurface === undefined
      ? check(
          "android.runtime-surface",
          "Solid Native Android surface",
          "fail",
          "No MainActivity source starts the package-owned SolidNativeSurface.",
          "Start SolidNativeSurface with the activity, ReactHost, and SolidNativeBindingsInstaller so surface and UI-worklet teardown remain package-owned.",
        )
      : check(
          "android.runtime-surface",
          "Solid Native Android surface",
          "pass",
          `Found the production surface bootstrap in ${path.relative(projectRoot, androidSurface)}.`,
        ),
  );

  const sdkPath = await findAndroidSdk(env, dependencies);
  checks.push(
    sdkPath === undefined
      ? check(
          "android.sdk",
          "Android SDK",
          "fail",
          "No Android SDK directory was found.",
          "Install Android Studio's SDK, then set ANDROID_HOME or ANDROID_SDK_ROOT.",
        )
      : check("android.sdk", "Android SDK", "pass", `Found ${sdkPath}.`),
  );

  const adbCommand =
    sdkPath !== undefined &&
    (await dependencies.pathExists(path.join(sdkPath, "platform-tools", "adb")))
      ? path.join(sdkPath, "platform-tools", "adb")
      : "adb";
  const javaHome = await findAndroidJavaHome(env, dependencies);
  const javaCommand =
    javaHome === undefined
      ? "java"
      : path.join(
          javaHome,
          "bin",
          dependencies.hostPlatform === "win32" ? "java.exe" : "java",
        );
  const [java, adb] = await Promise.all([
    runTool(dependencies, env, projectRoot, javaCommand, ["-version"]),
    runTool(dependencies, env, projectRoot, adbCommand, ["version"]),
  ]);
  const javaMajor = parseJavaMajor(commandOutput(java));
  checks.push(
    java.exitCode === 0 && javaMajor !== undefined && javaMajor >= 17
      ? check(
          "android.java",
          "Java",
          "pass",
          javaHome === undefined
            ? `Java ${javaMajor} is available.`
            : `Java ${javaMajor} is available from ${javaHome}.`,
        )
      : java.exitCode === 0 && javaMajor !== undefined
        ? check(
            "android.java",
            "Java",
            "fail",
            `Java ${javaMajor} is too old; Java 17 or newer is required.`,
            "Install a JDK 17+ distribution and update JAVA_HOME.",
          )
        : commandFailure(
            "android.java",
            "Java",
            "java",
            java,
            "Install a JDK 17+ distribution and update JAVA_HOME.",
          ),
  );
  checks.push(
    adb.exitCode === 0
      ? check(
          "android.adb",
          "Android Debug Bridge",
          "pass",
          firstLine(commandOutput(adb)) || "adb is available.",
        )
      : commandFailure(
          "android.adb",
          "Android Debug Bridge",
          "adb",
          adb,
          "Install Android SDK Platform-Tools and add adb to PATH.",
        ),
  );
  return checks;
}

async function findAndroidSdk(
  env: NodeJS.ProcessEnv,
  dependencies: Pick<
    DoctorDependencies,
    "homeDirectory" | "hostPlatform" | "pathExists"
  >,
): Promise<string | undefined> {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    dependencies.hostPlatform === "darwin"
      ? path.join(dependencies.homeDirectory, "Library", "Android", "sdk")
      : path.join(dependencies.homeDirectory, "Android", "Sdk"),
  ].filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0,
  );
  for (const candidate of candidates) {
    if (await dependencies.pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function findAndroidJavaHome(
  env: NodeJS.ProcessEnv,
  dependencies: Pick<
    DoctorDependencies,
    "homeDirectory" | "hostPlatform" | "pathExists"
  >,
): Promise<string | undefined> {
  if (typeof env.JAVA_HOME === "string" && env.JAVA_HOME.length > 0) {
    return path.resolve(env.JAVA_HOME);
  }
  const candidates =
    dependencies.hostPlatform === "darwin"
      ? [
          path.join(
            dependencies.homeDirectory,
            "Applications",
            "Android Studio.app",
            "Contents",
            "jbr",
            "Contents",
            "Home",
          ),
          path.join(
            "/Applications",
            "Android Studio.app",
            "Contents",
            "jbr",
            "Contents",
            "Home",
          ),
          path.join(
            "/Applications",
            "Android Studio Preview.app",
            "Contents",
            "jbr",
            "Contents",
            "Home",
          ),
        ]
      : dependencies.hostPlatform === "linux"
        ? [
            path.join(dependencies.homeDirectory, "android-studio", "jbr"),
            path.join("/opt", "android-studio", "jbr"),
          ]
        : dependencies.hostPlatform === "win32"
          ? [
              ...(typeof env.LOCALAPPDATA === "string"
                ? [
                    path.join(
                      env.LOCALAPPDATA,
                      "Programs",
                      "Android Studio",
                      "jbr",
                    ),
                  ]
                : []),
              ...(typeof env.ProgramFiles === "string"
                ? [
                    path.join(
                      env.ProgramFiles,
                      "Android",
                      "Android Studio",
                      "jbr",
                    ),
                  ]
                : []),
            ]
          : [];
  const executable =
    dependencies.hostPlatform === "win32" ? "java.exe" : "java";
  for (const candidate of candidates) {
    if (
      await dependencies.pathExists(path.join(candidate, "bin", executable))
    ) {
      return candidate;
    }
  }
  return undefined;
}

async function iosChecks(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  dependencies: DoctorDependencies,
): Promise<readonly DoctorCheck[]> {
  const iosDirectory = path.join(projectRoot, "ios");
  if (!(await dependencies.pathExists(iosDirectory))) {
    return [
      check(
        "ios.project",
        "iOS project",
        "skip",
        "No ios directory exists in this project.",
      ),
    ];
  }
  const checks: DoctorCheck[] = [
    check("ios.project", "iOS project", "pass", `Found ${iosDirectory}.`),
  ];
  const podfilePath = path.join(iosDirectory, "Podfile");
  let podfile: string | undefined;
  try {
    podfile = await dependencies.readTextFile(podfilePath);
    checks.push(check("ios.podfile", "Podfile", "pass", "Found ios/Podfile."));
  } catch {
    checks.push(
      check(
        "ios.podfile",
        "Podfile",
        "fail",
        "ios/Podfile is missing or unreadable.",
        "Regenerate or restore the native iOS project.",
      ),
    );
  }
  checks.push(
    podfile?.includes("@solid-native/fabric-host/ios-podspec") === true &&
      podfile.includes("SolidNativeFabric")
      ? check(
          "ios.runtime-pod",
          "Solid Native iOS pod",
          "pass",
          "The Podfile resolves SolidNativeFabric through the installed Fabric Host package.",
        )
      : check(
          "ios.runtime-pod",
          "Solid Native iOS pod",
          podfile === undefined ? "skip" : "fail",
          podfile === undefined
            ? "The runtime pod cannot be checked without a readable Podfile."
            : "The Podfile does not resolve @solid-native/fabric-host/ios-podspec.",
          "Resolve @solid-native/fabric-host/ios-podspec with Node and pass its directory to the SolidNativeFabric pod.",
        ),
  );

  const iosBootstrap = await findNativeSourceWithTokens(
    iosDirectory,
    new Set(["AppDelegate.m", "AppDelegate.mm", "AppDelegate.swift"]),
    ["SolidNativeFabric", "SolidNativeFabricApplication"],
    dependencies,
  );
  checks.push(
    iosBootstrap === undefined
      ? check(
          "ios.runtime-bootstrap",
          "Solid Native iOS bootstrap",
          "fail",
          "No AppDelegate source starts SolidNativeFabricApplication.",
          "Import SolidNativeFabric and start its verified empty-surface application from the native AppDelegate.",
        )
      : check(
          "ios.runtime-bootstrap",
          "Solid Native iOS bootstrap",
          "pass",
          `Found the Solid Native bootstrap in ${path.relative(projectRoot, iosBootstrap)}.`,
        ),
  );

  const iosDebugRequest = await findNativeSourceWithTokens(
    iosDirectory,
    new Set(["AppDelegate.m", "AppDelegate.mm", "AppDelegate.swift"]),
    ["SolidNativeDebugRequest", "handle"],
    dependencies,
  );
  checks.push(
    iosDebugRequest === undefined
      ? check(
          "ios.runtime-debug-url",
          "Solid Native iOS debug request handoff",
          "fail",
          "No AppDelegate source routes CoreDevice payload URLs to SolidNativeDebugRequest.",
          "Route launch and open-URL callbacks through SolidNativeDebugRequest before application Linking.",
        )
      : check(
          "ios.runtime-debug-url",
          "Solid Native iOS debug request handoff",
          "pass",
          `Found the one-shot debug URL handoff in ${path.relative(projectRoot, iosDebugRequest)}.`,
        ),
  );

  try {
    const manifest = parseManifest(
      await dependencies.readTextFile(path.join(projectRoot, "package.json")),
    );
    const codegen = manifest.codegenConfig;
    const iosCodegen = isRecord(codegen?.ios) ? codegen.ios : undefined;
    const modulesProvider = isRecord(iosCodegen?.modulesProvider)
      ? iosCodegen.modulesProvider
      : undefined;
    checks.push(
      (codegen?.type === "modules" || codegen?.type === "all") &&
        codegen.jsSrcsDir === "specs" &&
        modulesProvider?.SolidNativeDebug === "SolidNativeDebugModule"
        ? check(
            "ios.runtime-codegen",
            "Solid Native debug TurboModule provider",
            "pass",
            "React Native Codegen owns the SolidNativeDebug iOS provider mapping.",
          )
        : check(
            "ios.runtime-codegen",
            "Solid Native debug TurboModule provider",
            "fail",
            "The iOS application does not declare the SolidNativeDebug provider mapping.",
            "Map SolidNativeDebug to SolidNativeDebugModule in codegenConfig.ios.modulesProvider.",
          ),
    );
  } catch (error) {
    checks.push(
      check(
        "ios.runtime-codegen",
        "Solid Native debug TurboModule provider",
        "fail",
        `Could not read the iOS SolidNativeDebug Codegen contract: ${errorMessage(error)}`,
        "Restore the scaffolded package.json codegenConfig.",
      ),
    );
  }
  if (dependencies.hostPlatform !== "darwin") {
    checks.push(
      check(
        "ios.xcode",
        "Xcode",
        "fail",
        `iOS builds require macOS; this host reports ${dependencies.hostPlatform}.`,
        "Run local iOS builds on a Mac with Xcode installed.",
      ),
    );
    return checks;
  }
  const [xcode, pods] = await Promise.all([
    runTool(dependencies, env, projectRoot, "xcodebuild", ["-version"]),
    runTool(dependencies, env, projectRoot, "pod", ["--version"]),
  ]);
  checks.push(
    xcode.exitCode === 0
      ? check(
          "ios.xcode",
          "Xcode",
          "pass",
          firstLine(commandOutput(xcode)) || "xcodebuild is available.",
        )
      : commandFailure(
          "ios.xcode",
          "Xcode",
          "xcodebuild",
          xcode,
          "Install Xcode and select it with xcode-select.",
        ),
  );
  checks.push(
    pods.exitCode === 0
      ? check(
          "ios.cocoapods",
          "CocoaPods",
          "pass",
          `CocoaPods ${firstLine(commandOutput(pods)) || "is available"}.`,
        )
      : commandFailure(
          "ios.cocoapods",
          "CocoaPods",
          "pod",
          pods,
          "Install CocoaPods and ensure pod is available on PATH.",
        ),
  );
  return checks;
}

export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const dependencies = { ...defaultDependencies(), ...options.dependencies };
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const platform = options.platform ?? "all";
  const env = options.env ?? process.env;
  const checks: DoctorCheck[] = [];

  const nodeVersion = parseVersion(dependencies.nodeVersion);
  const nodeSupported =
    nodeVersion !== undefined &&
    ((nodeVersion.major === 22 && nodeVersion.minor >= 13) ||
      (nodeVersion.major === 24 && nodeVersion.minor >= 3) ||
      nodeVersion.major >= 26);
  checks.push(
    nodeSupported
      ? check(
          "runtime.node",
          "Node.js",
          "pass",
          `Node.js ${dependencies.nodeVersion} satisfies the React Native 0.87 toolchain requirement.`,
        )
      : check(
          "runtime.node",
          "Node.js",
          "fail",
          `Node.js ${dependencies.nodeVersion} is outside the React Native 0.87 toolchain range.`,
          "Install Node.js 22.13+, 24.3+, or 26+ before running Solid Native tooling.",
        ),
  );

  const discoveredRoot = await findProjectRoot(cwd, dependencies.pathExists);
  const projectRoot = discoveredRoot ?? cwd;
  if (discoveredRoot === undefined) {
    checks.push(
      check(
        "project.manifest",
        "Project manifest",
        "fail",
        `No package.json was found at or above ${cwd}.`,
        "Run this command inside a Solid Native project.",
      ),
    );
  } else {
    let manifest: ProjectManifest | undefined;
    try {
      manifest = parseManifest(
        await dependencies.readTextFile(path.join(projectRoot, "package.json")),
      );
      checks.push(
        check(
          "project.manifest",
          "Project manifest",
          "pass",
          `Loaded ${manifest.name ?? "unnamed project"} from ${projectRoot}.`,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "project.manifest",
          "Project manifest",
          "fail",
          `Could not parse package.json: ${errorMessage(error)}`,
          "Fix package.json before running native tooling.",
        ),
      );
    }

    if (manifest !== undefined) {
      const workspaceRoot = await dependencies.pathExists(
        path.join(projectRoot, "pnpm-workspace.yaml"),
      );
      const coreVersion = declaredVersion(manifest, "@solid-native/core");
      const fabricHostVersion = declaredVersion(
        manifest,
        "@solid-native/fabric-host",
      );
      const runtimeVersion = declaredVersion(manifest, "@solid-native/runtime");
      const hasMatchingPackages =
        coreVersion !== undefined &&
        fabricHostVersion !== undefined &&
        runtimeVersion !== undefined &&
        coreVersion === fabricHostVersion &&
        coreVersion === runtimeVersion;
      const isWorkspaceContainer =
        workspaceRoot &&
        coreVersion === undefined &&
        fabricHostVersion === undefined &&
        runtimeVersion === undefined;
      checks.push(
        isWorkspaceContainer || hasMatchingPackages
          ? check(
              "project.solid-native",
              "Solid Native packages",
              "pass",
              isWorkspaceContainer
                ? "Detected a Solid Native pnpm workspace."
                : `Declared matching @solid-native/core, @solid-native/fabric-host, and @solid-native/runtime ${coreVersion}.`,
            )
          : check(
              "project.solid-native",
              "Solid Native packages",
              "fail",
              coreVersion === undefined ||
                fabricHostVersion === undefined ||
                runtimeVersion === undefined
                ? "@solid-native/core, @solid-native/fabric-host, and @solid-native/runtime must be declared."
                : `@solid-native/core ${coreVersion}, @solid-native/fabric-host ${fabricHostVersion}, and @solid-native/runtime ${runtimeVersion} do not match.`,
              "Add matching Solid Native core, Fabric Host, and runtime versions to the application.",
            ),
      );
      checks.push(
        await installedSolidNativePackagesCheck(
          projectRoot,
          platform,
          {
            core: coreVersion,
            fabricHost: fabricHostVersion,
            runtime: runtimeVersion,
          },
          dependencies,
        ),
      );

      const reactNativeVersion = declaredVersion(manifest, "react-native");
      checks.push(
        reactNativeVersion === VERIFIED_REACT_NATIVE_VERSION
          ? check(
              "project.react-native",
              "React Native backend",
              "pass",
              `React Native is exactly pinned to the device-verified ${VERIFIED_REACT_NATIVE_VERSION} backend.`,
            )
          : workspaceRoot && reactNativeVersion === undefined
            ? check(
                "project.react-native",
                "React Native backend",
                "skip",
                "This workspace root does not declare an application React Native backend.",
              )
            : check(
                "project.react-native",
                "React Native backend",
                "fail",
                reactNativeVersion === undefined
                  ? "react-native is not declared."
                  : `react-native is declared as ${reactNativeVersion}; only exact ${VERIFIED_REACT_NATIVE_VERSION} is device-verified.`,
                `Pin react-native to exactly ${VERIFIED_REACT_NATIVE_VERSION} until another backend version is verified.`,
              ),
      );
      const navigationBackend = await installedNavigationBackendCheck(
        projectRoot,
        manifest,
        reactNativeVersion,
        dependencies,
      );
      if (navigationBackend !== undefined) {
        checks.push(navigationBackend);
      }
      if (reactNativeVersion === VERIFIED_REACT_NATIVE_VERSION) {
        const javascriptChecks = await javascriptApplicationChecks(
          projectRoot,
          manifest,
          dependencies,
        );
        const installedHermes = await inspectInstalledHermesCompatibility(
          projectRoot,
          manifest,
          dependencies,
          dependencies.hostPlatform,
        );
        const hasHermesPair = javascriptChecks.some(
          (entry) => entry.id === "project.hermes-pair",
        );
        checks.push(
          ...javascriptChecks.map((entry) =>
            entry.id === "project.hermes-pair" ? installedHermes.check : entry,
          ),
          ...(hasHermesPair ? [] : [installedHermes.check]),
        );
        checks.push(
          await probeHermesBytecodeCompatibility(
            projectRoot,
            env,
            installedHermes,
            dependencies,
          ),
        );
      }

      const inheritedPackageManager =
        manifest.packageManager === undefined
          ? await findInheritedPackageManager(projectRoot, dependencies)
          : undefined;
      const packageManager =
        manifest.packageManager ?? inheritedPackageManager?.value;
      if (packageManager === undefined) {
        checks.push(
          check(
            "project.package-manager",
            "Package manager",
            "warn",
            "package.json does not declare packageManager; reproducible pnpm selection is not enforced.",
            "Add a packageManager field such as pnpm@9.15.0.",
          ),
        );
      } else if (/^pnpm@9(?:\.|$)/u.test(packageManager)) {
        checks.push(
          check(
            "project.package-manager",
            "Package manager",
            "pass",
            inheritedPackageManager === undefined
              ? `Using ${packageManager}.`
              : `Using ${packageManager} from ${inheritedPackageManager.source}.`,
          ),
        );
      } else {
        checks.push(
          check(
            "project.package-manager",
            "Package manager",
            "warn",
            `The repository currently validates pnpm 9, but packageManager is ${packageManager}.`,
            "Use the repository-pinned pnpm 9 release or validate the alternate package manager explicitly.",
          ),
        );
      }
      if (
        reactNativeVersion === VERIFIED_REACT_NATIVE_VERSION &&
        /^pnpm@9(?:\.|$)/u.test(packageManager ?? "")
      ) {
        const lockfile = await findAncestorFile(
          projectRoot,
          "pnpm-lock.yaml",
          dependencies.pathExists,
        );
        checks.push(
          lockfile === undefined
            ? check(
                "project.lockfile",
                "Dependency lockfile",
                "fail",
                "No pnpm-lock.yaml was found at or above the application.",
                "Run pnpm install and commit the resulting pnpm-lock.yaml before treating the native build as reproducible.",
              )
            : check(
                "project.lockfile",
                "Dependency lockfile",
                "pass",
                `Found ${lockfile}.`,
              ),
        );
      }
    }

    if (platform === "all" || platform === "ios") {
      checks.push(...(await iosChecks(projectRoot, env, dependencies)));
    }
    if (platform === "all" || platform === "android") {
      checks.push(...(await androidChecks(projectRoot, env, dependencies)));
    }
  }

  const summary: DoctorSummary = {
    pass: checks.filter((entry) => entry.status === "pass").length,
    warn: checks.filter((entry) => entry.status === "warn").length,
    fail: checks.filter((entry) => entry.status === "fail").length,
    skip: checks.filter((entry) => entry.status === "skip").length,
  };
  return {
    schemaVersion: 0,
    ok: summary.fail === 0,
    projectRoot,
    platform,
    checks,
    summary,
  };
}

const PROJECT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;
const PACKAGE_NAME_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u;
const CREATE_TEMPLATE_DIRECTORY = fileURLToPath(
  new URL("../templates/react-native-0.87", import.meta.url),
);
const requireFromCli = createRequire(import.meta.url);
const SOLID_NATIVE_DEPENDENCY_VERSION =
  SOLID_NATIVE_CLI_VERSION === "0.0.0"
    ? SOLID_NATIVE_CLI_VERSION
    : `^${SOLID_NATIVE_CLI_VERSION}`;

function assertProjectName(value: string): void {
  if (value.length > 64 || !PROJECT_NAME_PATTERN.test(value)) {
    throw new TypeError(
      "The project name must be a 1-64 character identifier beginning with a letter.",
    );
  }
}

function assertPackageName(value: string): void {
  if (value.length > 160 || !PACKAGE_NAME_PATTERN.test(value)) {
    throw new TypeError(
      "The package name must be a lowercase reverse-DNS identifier such as dev.example.application.",
    );
  }
}

function assertApplicationTitle(value: string): void {
  if (
    value.trim().length === 0 ||
    value.length > 128 ||
    /[\r\n]/u.test(value)
  ) {
    throw new TypeError(
      "The application title must be 1-128 characters on one line.",
    );
  }
}

function defaultPackageName(projectName: string): string {
  return `dev.solidnative.${projectName.toLowerCase()}`;
}

function npmPackageName(projectName: string): string {
  return projectName.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
}

function resolveReactNativeCommunityCli(explicitPath?: string): string {
  if (explicitPath !== undefined) return path.resolve(explicitPath);
  const manifest = requireFromCli.resolve(
    "@react-native-community/cli/package.json",
  );
  return path.join(path.dirname(manifest), "build", "bin.js");
}

export async function createNativeCreatePlan(
  options: NativeCreateOptions,
): Promise<NativeCreatePlan> {
  assertProjectName(options.projectName);
  const title = options.title ?? options.projectName;
  assertApplicationTitle(title);
  const packageName =
    options.packageName ?? defaultPackageName(options.projectName);
  assertPackageName(packageName);

  const creationRoot = path.resolve(options.cwd ?? process.cwd());
  const pathExists =
    options.dependencies?.pathExists ??
    (async (target: string) => {
      try {
        await access(target);
        return true;
      } catch {
        return false;
      }
    });
  if (!(await pathExists(creationRoot))) {
    throw new TypeError(
      `The creation directory does not exist: ${creationRoot}`,
    );
  }
  const targetDirectory = path.resolve(
    creationRoot,
    options.directory ?? options.projectName,
  );
  if (await pathExists(targetDirectory)) {
    throw new TypeError(
      `Refusing to replace the existing create target: ${targetDirectory}`,
    );
  }

  const reactNativeCommunityCli = resolveReactNativeCommunityCli(
    options.dependencies?.reactNativeCommunityCli,
  );
  return {
    schemaVersion: 0,
    operation: "create",
    projectName: options.projectName,
    packageName,
    title,
    targetDirectory,
    packageManager: "pnpm@9.15.0",
    projectRoot: creationRoot,
    command: process.execPath,
    args: [
      reactNativeCommunityCli,
      "init",
      options.projectName,
      "--version",
      VERIFIED_REACT_NATIVE_VERSION,
      "--directory",
      targetDirectory,
      "--package-name",
      packageName,
      "--title",
      title,
      "--pm",
      "npm",
      "--skip-install",
      "--skip-git-init",
      "--replace-directory",
      "false",
      "--install-pods",
      "false",
    ],
    ...(options.skipInstall === true
      ? {}
      : {
          installCommand: {
            projectRoot: targetDirectory,
            command: "pnpm",
            args: ["install"],
          },
        }),
  };
}

function requireGeneratedMarker(
  source: string,
  marker: string,
  relativePath: string,
): void {
  if (!source.includes(marker)) {
    throw new TypeError(
      `The React Native ${VERIFIED_REACT_NATIVE_VERSION} template changed ${relativePath}; expected ${JSON.stringify(marker)}. No Solid Native integration was written.`,
    );
  }
}

function replaceGeneratedMarker(
  source: string,
  marker: string,
  replacement: string,
  relativePath: string,
): string {
  requireGeneratedMarker(source, marker, relativePath);
  return source.replace(marker, replacement);
}

function requiredStringRecord(
  value: unknown,
  location: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${location} must be an object.`);
  }
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new TypeError(`${location}.${name} must be a string.`);
    }
    result[name] = entry;
  }
  return result;
}

function removeKeys(
  source: Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  const result = { ...source };
  for (const key of keys) delete result[key];
  return result;
}

function generatedPackageManifest(source: string, projectName: string): string {
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("The generated package.json must contain an object.");
  }
  const manifest = parsed as Record<string, unknown>;
  const dependencies = removeKeys(
    requiredStringRecord(manifest.dependencies, "package.json dependencies"),
    ["@react-native/new-app-screen"],
  );
  const devDependencies = removeKeys(
    requiredStringRecord(
      manifest.devDependencies,
      "package.json devDependencies",
    ),
    [
      "@react-native/eslint-config",
      "@react-native/jest-preset",
      "@types/jest",
      "@types/react-test-renderer",
      "eslint",
      "jest",
      "prettier",
      "react-test-renderer",
    ],
  );
  const scripts = removeKeys(
    requiredStringRecord(manifest.scripts, "package.json scripts"),
    ["lint", "test"],
  );
  if (dependencies["react-native"] !== VERIFIED_REACT_NATIVE_VERSION) {
    throw new TypeError(
      `The generated package.json did not pin react-native to ${VERIFIED_REACT_NATIVE_VERSION}.`,
    );
  }

  return `${JSON.stringify(
    {
      ...manifest,
      name: npmPackageName(projectName),
      packageManager: "pnpm@9.15.0",
      codegenConfig: {
        name: "SolidNativeAppSpec",
        type: "modules",
        jsSrcsDir: "specs",
        android: {
          javaPackageName: "dev.solidnative.runtime",
        },
        ios: {
          modulesProvider: {
            SolidNativeDebug: "SolidNativeDebugModule",
          },
        },
      },
      scripts: {
        ...scripts,
        android: "solid-native run android",
        ios: "solid-native run ios",
        "build:android": "solid-native build android",
        "build:ios": "solid-native build ios",
        "bundle:android": "solid-native bundle android",
        "bundle:ios": "solid-native bundle ios",
        doctor: "solid-native doctor",
        fingerprint: "solid-native fingerprint",
        generate: "solid-native generate",
        release: "solid-native release",
        start: "solid-native start",
        test: "solid-native test",
        check: "tsc -p tsconfig.json --noEmit",
      },
      dependencies: {
        ...dependencies,
        "@solid-native/accessibility": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/animation": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/core": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/devtools": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/dialogs": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/fabric-host": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/networking": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/observability": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/renderer": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/runtime": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/sharing": SOLID_NATIVE_DEPENDENCY_VERSION,
        "react-native-safe-area-context": VERIFIED_SAFE_AREA_CONTEXT_VERSION,
        "solid-js": VERIFIED_SOLID_VERSION,
      },
      devDependencies: {
        ...devDependencies,
        "@react-native/codegen": VERIFIED_REACT_NATIVE_VERSION,
        "@react-native/gradle-plugin": VERIFIED_REACT_NATIVE_VERSION,
        "@solid-native/cli": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/metro": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@solid-native/testing": SOLID_NATIVE_DEPENDENCY_VERSION,
        "@types/node": "^22.10.0",
        "hermes-compiler": VERIFIED_HERMES_COMPILER_VERSION,
        typescript: "^5.9.2",
      },
      engines: {
        node: "^22.13.0 || ^24.3.0 || >=26.0.0",
      },
    },
    null,
    2,
  )}\n`;
}

function generatedGitIgnore(source: string): string {
  const entry = "/build/solid-native-codegen/";
  if (source.split(/\r?\n/u).includes(entry)) return source;
  const terminated = source.endsWith("\n") ? source : `${source}\n`;
  return `${terminated}\n# Solid Native generated artifacts\n${entry}\n`;
}

async function readCreateTemplate(
  relativePath: string,
  replacements: Readonly<Record<string, string>>,
): Promise<string> {
  let source = await readFile(
    path.join(CREATE_TEMPLATE_DIRECTORY, relativePath),
    "utf8",
  );
  for (const [name, value] of Object.entries(replacements)) {
    source = source.replaceAll(`__${name}__`, value);
  }
  const unresolved = /__(?!DEV__)[A-Z_]+__/u.exec(source);
  if (unresolved !== null) {
    throw new TypeError(
      `The Solid Native create template retained unresolved token ${unresolved[0]} in ${relativePath}.`,
    );
  }
  return source;
}

export async function applyNativeCreateTemplate(
  plan: NativeCreatePlan,
): Promise<void> {
  const target = plan.targetDirectory;
  const androidPackageDirectory = path.join(
    target,
    "android",
    "app",
    "src",
    "main",
    "java",
    ...plan.packageName.split("."),
  );
  const paths = {
    packageManifest: path.join(target, "package.json"),
    gitIgnore: path.join(target, ".gitignore"),
    appBuild: path.join(target, "android", "app", "build.gradle"),
    gradleProperties: path.join(target, "android", "gradle.properties"),
    mainApplication: path.join(androidPackageDirectory, "MainApplication.kt"),
    mainActivity: path.join(androidPackageDirectory, "MainActivity.kt"),
    podfile: path.join(target, "ios", "Podfile"),
    infoPlist: path.join(target, "ios", plan.projectName, "Info.plist"),
    appDelegate: path.join(
      target,
      "ios",
      plan.projectName,
      "AppDelegate.swift",
    ),
  };
  const [
    packageManifest,
    gitIgnore,
    appBuild,
    gradleProperties,
    mainApplication,
    mainActivity,
    podfile,
    infoPlist,
    appDelegate,
  ] = await Promise.all([
    readFile(paths.packageManifest, "utf8"),
    readFile(paths.gitIgnore, "utf8"),
    readFile(paths.appBuild, "utf8"),
    readFile(paths.gradleProperties, "utf8"),
    readFile(paths.mainApplication, "utf8"),
    readFile(paths.mainActivity, "utf8"),
    readFile(paths.podfile, "utf8"),
    readFile(paths.infoPlist, "utf8"),
    readFile(paths.appDelegate, "utf8"),
  ]);

  requireGeneratedMarker(
    mainApplication,
    "getDefaultReactHost",
    "android MainApplication.kt",
  );
  requireGeneratedMarker(
    mainActivity,
    "ReactActivity",
    "android MainActivity.kt",
  );
  requireGeneratedMarker(
    appDelegate,
    "RCTReactNativeFactory",
    "iOS AppDelegate.swift",
  );

  const gradleIntegration = `apply plugin: "com.facebook.react"

def solidNativeAndroidGradle = file(
    providers.exec {
        workingDir(rootProject.projectDir)
        commandLine(
            "node",
            "--print",
            "require.resolve('@solid-native/fabric-host/android-gradle')"
        )
    }.standardOutput.asText.get().trim()
)
apply from: solidNativeAndroidGradle`;
  let nextAppBuild = replaceGeneratedMarker(
    appBuild,
    'apply plugin: "com.facebook.react"',
    gradleIntegration,
    "android/app/build.gradle",
  );
  nextAppBuild = replaceGeneratedMarker(
    nextAppBuild,
    "android {",
    `android {
    externalNativeBuild {
        cmake {
            path "src/main/jni/CMakeLists.txt"
        }
    }`,
    "android/app/build.gradle",
  );
  nextAppBuild = replaceGeneratedMarker(
    nextAppBuild,
    "dependencies {",
    `dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")`,
    "android/app/build.gradle",
  );

  const nextGradleProperties = replaceGeneratedMarker(
    gradleProperties,
    "edgeToEdgeEnabled=true",
    "edgeToEdgeEnabled=false",
    "android/gradle.properties",
  );
  const podResolution = `solid_native_fabric_host_native_path = File.dirname(
  Pod::Executable.execute_command('node', ['--preserve-symlinks', '-p',
    'require.resolve(
      "@solid-native/fabric-host/ios-podspec",
      {paths: [process.argv[1]]},
    )', __dir__]).strip
)
solid_native_fabric_host_native_path = Pathname
  .new(solid_native_fabric_host_native_path)
  .relative_path_from(Pathname.new(__dir__))
  .to_s

platform :ios`;
  let nextPodfile = replaceGeneratedMarker(
    podfile,
    "platform :ios",
    podResolution,
    "ios/Podfile",
  );
  nextPodfile = replaceGeneratedMarker(
    nextPodfile,
    "  config = use_native_modules!",
    `  config = use_native_modules!

  pod 'SolidNativeFabric', :path => solid_native_fabric_host_native_path`,
    "ios/Podfile",
  );
  const nextInfoPlist = replaceGeneratedMarker(
    infoPlist,
    "\t<key>NSLocationWhenInUseUsageDescription</key>\n\t<string></string>\n",
    "\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<false/>\n",
    "iOS Info.plist",
  );

  const replacements = {
    ANDROID_PACKAGE: plan.packageName,
    APP_TITLE: plan.title,
    APP_TITLE_LITERAL: JSON.stringify(plan.title),
    IOS_BUNDLE_ID: plan.packageName,
    PROJECT_NAME: plan.projectName,
  };
  const templateFiles = await Promise.all(
    [
      "index.js",
      "src/App.tsx",
      "src/main.tsx",
      "test/App.test.tsx",
      "specs/NativeSolidNativeDebug.ts",
      "specs/NativeSolidNativePlatformAndroid.ts",
      "metro.config.js",
      "android/CMakeLists.txt",
      "android/OnLoad.cpp",
      "android/MainApplication.kt",
      "android/MainActivity.kt",
      "ios/AppDelegate.swift",
      "README.md",
    ].map(async (relativePath) => ({
      relativePath,
      source: await readCreateTemplate(relativePath, replacements),
    })),
  );

  await Promise.all([
    mkdir(path.join(target, "src"), { recursive: true }),
    mkdir(path.join(target, "specs"), { recursive: true }),
    mkdir(path.join(target, "test"), { recursive: true }),
    mkdir(path.join(target, "android", "app", "src", "main", "jni"), {
      recursive: true,
    }),
  ]);
  const templateDestinations: Readonly<Record<string, string>> = {
    "index.js": path.join(target, "index.js"),
    "src/App.tsx": path.join(target, "src", "App.tsx"),
    "src/main.tsx": path.join(target, "src", "main.tsx"),
    "test/App.test.tsx": path.join(target, "test", "App.test.tsx"),
    "specs/NativeSolidNativeDebug.ts": path.join(
      target,
      "specs",
      "NativeSolidNativeDebug.ts",
    ),
    "specs/NativeSolidNativePlatformAndroid.ts": path.join(
      target,
      "specs",
      "NativeSolidNativePlatformAndroid.ts",
    ),
    "metro.config.js": path.join(target, "metro.config.js"),
    "android/CMakeLists.txt": path.join(
      target,
      "android",
      "app",
      "src",
      "main",
      "jni",
      "CMakeLists.txt",
    ),
    "android/OnLoad.cpp": path.join(
      target,
      "android",
      "app",
      "src",
      "main",
      "jni",
      "OnLoad.cpp",
    ),
    "android/MainApplication.kt": paths.mainApplication,
    "android/MainActivity.kt": paths.mainActivity,
    "ios/AppDelegate.swift": paths.appDelegate,
    "README.md": path.join(target, "README.md"),
  };
  await Promise.all([
    writeFile(
      paths.packageManifest,
      generatedPackageManifest(packageManifest, plan.projectName),
    ),
    writeFile(paths.gitIgnore, generatedGitIgnore(gitIgnore)),
    writeFile(paths.appBuild, nextAppBuild),
    writeFile(paths.gradleProperties, nextGradleProperties),
    writeFile(paths.podfile, nextPodfile),
    writeFile(paths.infoPlist, nextInfoPlist),
    writeFile(
      path.join(target, "tsconfig.json"),
      `${JSON.stringify(
        {
          extends: "@react-native/typescript-config",
          compilerOptions: {
            jsx: "preserve",
            jsxImportSource: "@solid-native/core",
            allowImportingTsExtensions: true,
            types: ["react-native", "node"],
          },
          include: [
            "src/**/*.ts",
            "src/**/*.tsx",
            "specs/**/*.ts",
            "test/**/*.ts",
            "test/**/*.tsx",
          ],
          exclude: ["**/node_modules", "**/Pods"],
        },
        null,
        2,
      )}\n`,
    ),
    ...templateFiles.map(({ relativePath, source }) =>
      writeFile(templateDestinations[relativePath]!, source),
    ),
  ]);
  await Promise.all([
    rm(path.join(target, "App.tsx"), { force: true }),
    rm(path.join(target, "__tests__"), { force: true, recursive: true }),
    rm(path.join(target, "jest.config.js"), { force: true }),
    rm(path.join(target, ".eslintrc.js"), { force: true }),
    rm(path.join(target, ".prettierrc.js"), { force: true }),
  ]);
}

async function requireVerifiedJavaScriptApplication(
  application: NativeApplicationContext,
  platform: DoctorPlatform,
  dependencies: Pick<DoctorDependencies, "pathExists" | "readTextFile">,
): Promise<void> {
  const installedRuntime = await installedSolidNativePackagesCheck(
    application.projectRoot,
    platform,
    {
      core: declaredVersion(application.manifest, "@solid-native/core"),
      fabricHost: declaredVersion(
        application.manifest,
        "@solid-native/fabric-host",
      ),
      runtime: declaredVersion(application.manifest, "@solid-native/runtime"),
    },
    dependencies,
  );
  if (installedRuntime.status !== "pass") {
    throw new TypeError(
      `${installedRuntime.message}${
        installedRuntime.remediation === undefined
          ? ""
          : ` ${installedRuntime.remediation}`
      }`,
    );
  }
  const applicationFailure = (
    await javascriptApplicationChecks(
      application.projectRoot,
      application.manifest,
      dependencies,
    )
  ).find((entry) => entry.status === "fail");
  if (applicationFailure !== undefined) {
    throw new TypeError(
      `${applicationFailure.label}: ${applicationFailure.message}${
        applicationFailure.remediation === undefined
          ? ""
          : ` ${applicationFailure.remediation}`
      }`,
    );
  }
}

async function resolveNativeProcessApplication(
  options: NativeRunOptions | NativeBuildOptions,
): Promise<{
  readonly application: NativeApplicationContext;
  readonly environmentDefaults: Readonly<Record<string, string>>;
}> {
  const dependencies = fileDependencies(options.dependencies);
  const application = await resolveNativeApplication(options.cwd, dependencies);
  await requireVerifiedJavaScriptApplication(
    application,
    options.platform,
    dependencies,
  );
  const runEnvironment = options.env ?? process.env;
  const environmentDefaults: Record<string, string> = {};
  if (
    options.platform === "android" &&
    runEnvironment.ANDROID_HOME === undefined &&
    runEnvironment.ANDROID_SDK_ROOT === undefined
  ) {
    const androidSdk = await findAndroidSdk(runEnvironment, {
      homeDirectory: options.dependencies?.homeDirectory ?? homedir(),
      hostPlatform: options.dependencies?.hostPlatform ?? process.platform,
      pathExists: dependencies.pathExists,
    });
    if (androidSdk !== undefined) environmentDefaults.ANDROID_HOME = androidSdk;
  }
  if (
    options.platform === "android" &&
    runEnvironment.JAVA_HOME === undefined
  ) {
    const androidJavaHome = await findAndroidJavaHome(runEnvironment, {
      homeDirectory: options.dependencies?.homeDirectory ?? homedir(),
      hostPlatform: options.dependencies?.hostPlatform ?? process.platform,
      pathExists: dependencies.pathExists,
    });
    if (androidJavaHome !== undefined) {
      environmentDefaults.JAVA_HOME = androidJavaHome;
    }
  }
  await requireNativeDirectory(
    application.projectRoot,
    options.platform,
    dependencies.pathExists,
  );
  return { application, environmentDefaults };
}

export async function createNativeStartPlan(
  options: NativeStartOptions = {},
): Promise<NativeStartPlan> {
  const dependencies = fileDependencies(options.dependencies);
  const application = await resolveNativeApplication(options.cwd, dependencies);
  await requireVerifiedJavaScriptApplication(application, "all", dependencies);
  return {
    schemaVersion: 0,
    operation: "start",
    projectRoot: application.projectRoot,
    command: process.execPath,
    args: [
      application.reactNativeCli,
      "start",
      ...(options.forwardedArgs ?? []),
    ],
  };
}

function forwardedOptionValue(
  args: readonly string[],
  option: string,
): string | undefined {
  // Commander retains the last occurrence of a repeated scalar option. Walk
  // backward so destination preflights follow the same target resolution.
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument.startsWith(`${option}=`)) {
      const value = argument.slice(option.length + 1);
      return value.length === 0 ? undefined : value;
    }
    if (argument === option) {
      const value = args[index + 1];
      return value === undefined || value.startsWith("-") ? undefined : value;
    }
  }
  return undefined;
}

function iosDestinationPreflight(
  args: readonly string[],
): NativeIosRunDestinationSelector | undefined {
  // React Native gives --udid precedence over --device when both are present.
  const udid = forwardedOptionValue(args, "--udid");
  if (udid !== undefined) return { kind: "udid", value: udid };
  const device = forwardedOptionValue(args, "--device");
  return device === undefined ? undefined : { kind: "device", value: device };
}

function androidDestinationPreflight(
  args: readonly string[],
): NativeAndroidRunDestinationSelector | undefined {
  // The React Native CLI lets interactive/list selection replace an explicit
  // destination, so do not lease a device it will not necessarily use.
  if (
    hasForwardedOption(args, "--interactive") ||
    args.includes("-i") ||
    hasForwardedOption(args, "--list-devices")
  ) {
    return undefined;
  }
  // React Native's deprecated deviceId option overwrites device when both are
  // present. Preserve that precedence so the preflight and native CLI agree.
  const deviceId = forwardedOptionValue(args, "--deviceId");
  if (hasForwardedOption(args, "--deviceId") && deviceId === undefined) {
    throw new TypeError("run android --deviceId requires a device serial.");
  }
  if (deviceId !== undefined) {
    return { kind: "deviceId", value: deviceId };
  }
  const device = forwardedOptionValue(args, "--device");
  if (hasForwardedOption(args, "--device") && device === undefined) {
    throw new TypeError("run android --device requires a device serial.");
  }
  return device === undefined
    ? { kind: "automatic" }
    : { kind: "device", value: device };
}

export async function createNativeRunPlan(
  options: NativeRunOptions,
): Promise<NativeRunPlan> {
  const { application, environmentDefaults } =
    await resolveNativeProcessApplication(options);
  const forwardedArgs = options.forwardedArgs ?? [];
  const iosPreflight =
    options.platform === "ios"
      ? iosDestinationPreflight(forwardedArgs)
      : undefined;
  const androidPreflight =
    options.platform === "android"
      ? androidDestinationPreflight(forwardedArgs)
      : undefined;
  return {
    schemaVersion: 0,
    operation: "run",
    platform: options.platform,
    projectRoot: application.projectRoot,
    command: process.execPath,
    args: [
      application.reactNativeCli,
      options.platform === "ios" ? "run-ios" : "run-android",
      ...forwardedArgs,
    ],
    ...(Object.keys(environmentDefaults).length === 0
      ? {}
      : { environmentDefaults }),
    ...(androidPreflight === undefined
      ? {}
      : { androidDestinationPreflight: androidPreflight }),
    ...(iosPreflight === undefined
      ? {}
      : { iosDestinationPreflight: iosPreflight }),
  };
}

function hasForwardedOption(args: readonly string[], option: string): boolean {
  return args.some(
    (argument) => argument === option || argument.startsWith(`${option}=`),
  );
}

const RESERVED_BUNDLE_OPTIONS = [
  "--asset-catalog-dest",
  "--assets-dest",
  "--bundle-encoding",
  "--bundle-output",
  "--config",
  "--dev",
  "--entry-file",
  "--minify",
  "--platform",
  "--sourcemap-output",
  "--sourcemap-sources-root",
  "--sourcemap-use-absolute-path",
  "--transformer",
] as const;

function pathContains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

async function requirePhysicalOutputContainment(
  projectRoot: string,
  target: string,
  label: string,
  dependencies: Pick<NativeGenerateFileDependencies, "pathExists" | "realPath">,
): Promise<void> {
  let existingAncestor = target;
  while (!(await dependencies.pathExists(existingAncestor))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const [physicalRoot, physicalAncestor] = await Promise.all([
    dependencies.realPath(projectRoot),
    dependencies.realPath(existingAncestor),
  ]);
  if (!pathContains(physicalRoot, physicalAncestor)) {
    throw new TypeError(
      `${label} must remain inside the application root after resolving symlinks.`,
    );
  }
}

export async function createNativeBundlePlan(
  options: NativeBundleOptions,
): Promise<NativeBundlePlan> {
  const dependencies = fileDependencies(options.dependencies);
  const application = await resolveNativeApplication(options.cwd, dependencies);
  const hermesSource = options.hermesSource === true;
  await requireVerifiedJavaScriptApplication(
    application,
    options.platform,
    dependencies,
  );
  await requireNativeDirectory(
    application.projectRoot,
    options.platform,
    dependencies.pathExists,
  );
  const forwardedArgs = options.forwardedArgs ?? [];
  for (const option of RESERVED_BUNDLE_OPTIONS) {
    if (hasForwardedOption(forwardedArgs, option)) {
      throw new TypeError(
        `${option} is owned by solid-native bundle and cannot be forwarded.`,
      );
    }
  }
  let entryFile =
    options.entryFile === undefined
      ? undefined
      : path.resolve(application.projectRoot, options.entryFile);
  if (entryFile === undefined) {
    for (const fileName of ["index.js", "index.tsx", "index.ts", "index.mjs"]) {
      const candidate = path.join(application.projectRoot, fileName);
      if (await dependencies.pathExists(candidate)) {
        entryFile = candidate;
        break;
      }
    }
  }
  if (
    entryFile === undefined ||
    !pathContains(application.projectRoot, entryFile) ||
    !(await dependencies.pathExists(entryFile))
  ) {
    throw new TypeError(
      `The bundle entry must be a present file inside ${application.projectRoot}.`,
    );
  }
  const lockfile = await findAncestorFile(
    application.projectRoot,
    "pnpm-lock.yaml",
    dependencies.pathExists,
  );
  if (lockfile === undefined) {
    throw new TypeError(
      "No pnpm-lock.yaml was found at or above the application; the source-map root is not reproducible.",
    );
  }
  const sourceRoot = path.dirname(lockfile);
  if (sourceRoot === path.parse(sourceRoot).root) {
    throw new TypeError(
      "The pnpm lockfile cannot define the filesystem root as a source-map trust boundary.",
    );
  }
  const outputDirectory = path.resolve(
    application.projectRoot,
    options.outputDirectory ??
      (options.platform === "android"
        ? path.join("android", "app", "build", "solid-native-bundle")
        : path.join("ios", "build", "solid-native-bundle")),
  );
  if (
    outputDirectory === sourceRoot ||
    pathContains(outputDirectory, application.projectRoot)
  ) {
    throw new TypeError(
      "The bundle output must not be the application, workspace, or an ancestor directory.",
    );
  }
  const bundlePath = path.join(
    outputDirectory,
    `index.${options.platform}.bundle`,
  );
  const sourceMapPath = hermesSource
    ? `${bundlePath}.packager.map`
    : `${bundlePath}.map`;
  const assetsDirectory = path.join(outputDirectory, "assets");
  const manifestPath = path.join(outputDirectory, "solid-native-bundle.json");
  return {
    schemaVersion: 0,
    operation: "bundle",
    platform: options.platform,
    projectRoot: application.projectRoot,
    sourceRoot,
    entryFile,
    entryPoint: path
      .relative(application.projectRoot, entryFile)
      .replaceAll(path.sep, "/"),
    outputDirectory,
    bundlePath,
    sourceMapPath,
    assetsDirectory,
    manifestPath,
    minified: !hermesSource,
    hermesSource,
    command: process.execPath,
    args: [
      application.reactNativeCli,
      "bundle",
      "--platform",
      options.platform,
      "--dev",
      "false",
      "--minify",
      hermesSource ? "false" : "true",
      "--entry-file",
      entryFile,
      "--bundle-output",
      bundlePath,
      "--sourcemap-output",
      sourceMapPath,
      "--sourcemap-sources-root",
      sourceRoot,
      "--assets-dest",
      assetsDirectory,
      ...forwardedArgs,
    ],
  };
}

export async function createNativeBuildPlan(
  options: NativeBuildOptions,
): Promise<NativeBuildPlan> {
  const { application, environmentDefaults } =
    await resolveNativeProcessApplication(options);
  const forwardedArgs = options.forwardedArgs ?? [];
  const selectsNativeConfiguration =
    hasForwardedOption(forwardedArgs, "--mode") ||
    hasForwardedOption(forwardedArgs, "--interactive") ||
    forwardedArgs.includes("-i") ||
    (options.platform === "android" &&
      hasForwardedOption(forwardedArgs, "--tasks"));
  return {
    schemaVersion: 0,
    operation: "build",
    platform: options.platform,
    projectRoot: application.projectRoot,
    command: process.execPath,
    args: [
      application.reactNativeCli,
      options.platform === "ios" ? "build-ios" : "build-android",
      ...(selectsNativeConfiguration ? [] : ["--mode", "Release"]),
      ...forwardedArgs,
    ],
    ...(Object.keys(environmentDefaults).length === 0
      ? {}
      : { environmentDefaults }),
  };
}

type NativeProcessPlan =
  | NativeBuildPlan
  | NativeBundlePlan
  | NativeCreateCommand
  | NativeGeneratePlan
  | NativeRunPlan
  | NativeStartPlan
  | NativeTestPlan;

const FORWARDED_NATIVE_SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

function nativeSignalExitCode(signal: NodeJS.Signals | null): number {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}

function forwardNativeSignal(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child if its process group has already gone.
    }
  }
  if (!child.killed) child.kill(signal);
}

const spawnNativeProcess = (
  plan: NativeProcessPlan,
  context: {
    readonly env: NodeJS.ProcessEnv;
    readonly output?: "inherit" | "quiet-on-success";
  },
): Promise<number> =>
  new Promise((resolve, reject) => {
    const quietOnSuccess = context.output === "quiet-on-success";
    const child = spawn(plan.command, [...plan.args], {
      cwd: plan.projectRoot,
      detached: process.platform !== "win32",
      env: context.env,
      stdio: quietOnSuccess ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const append = (
      current: string,
      chunk: Buffer,
    ): { readonly output: string; readonly truncated: boolean } => {
      const next = `${current}${chunk.toString("utf8")}`;
      return next.length <= MAX_COMMAND_OUTPUT
        ? { output: next, truncated: false }
        : {
            output: next.slice(-MAX_COMMAND_OUTPUT),
            truncated: true,
          };
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      const next = append(stdout, chunk);
      stdout = next.output;
      stdoutTruncated ||= next.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const next = append(stderr, chunk);
      stderr = next.output;
      stderrTruncated ||= next.truncated;
    });
    let capturedOutputWritten = false;
    const writeCapturedOutput = (): void => {
      if (!quietOnSuccess || capturedOutputWritten) return;
      capturedOutputWritten = true;
      if (stdout.length > 0) {
        process.stdout.write(
          `${stdoutTruncated ? "[Earlier scaffold output omitted.]\n" : ""}${stdout}`,
        );
      }
      if (stderr.length > 0) {
        process.stderr.write(
          `${stderrTruncated ? "[Earlier scaffold error output omitted.]\n" : ""}${stderr}`,
        );
      }
    };
    let forwardedSignal: NodeJS.Signals | undefined;
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
      signalHandlers.clear();
    };
    for (const signal of FORWARDED_NATIVE_SIGNALS) {
      const handler = () => {
        forwardedSignal ??= signal;
        forwardNativeSignal(child, signal);
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    child.once("error", (error) => {
      removeSignalHandlers();
      writeCapturedOutput();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      removeSignalHandlers();
      if (forwardedSignal !== undefined) {
        writeCapturedOutput();
        resolve(nativeSignalExitCode(forwardedSignal));
        return;
      }
      if (exitCode !== null) {
        if (exitCode !== 0) writeCapturedOutput();
        resolve(exitCode);
        return;
      }
      writeCapturedOutput();
      resolve(nativeSignalExitCode(signal));
    });
  });

export const defaultNativeRunExecutor: NativeRunExecutor = spawnNativeProcess;
export const defaultNativeBuildExecutor: NativeBuildExecutor =
  spawnNativeProcess;
export const defaultNativeBundleExecutor: NativeBundleExecutor =
  spawnNativeProcess;
export const defaultNativeStartExecutor: NativeStartExecutor =
  spawnNativeProcess;
export const defaultNativeTestExecutor: NativeTestExecutor = spawnNativeProcess;

export const defaultNativeCreateExecutor: NativeCreateExecutor =
  spawnNativeProcess;

async function createdScaffoldStatus(
  targetDirectory: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(targetDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function removeNewCreateScaffold(
  targetDirectory: string,
  cause: unknown,
): Promise<void> {
  const scaffold = await createdScaffoldStatus(targetDirectory);
  if (scaffold === undefined) return;
  if (!scaffold.isDirectory()) {
    throw new AggregateError(
      [
        cause,
        new TypeError(
          `Refusing to remove an unexpected non-directory create target: ${targetDirectory}`,
        ),
      ],
      `Solid Native creation failed and its target could not be cleaned safely: ${targetDirectory}.`,
    );
  }
  try {
    await rm(targetDirectory, { force: true, recursive: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [cause, cleanupError],
      `Solid Native creation failed and could not remove its new scaffold at ${targetDirectory}.`,
    );
  }
}

export async function executeNativeCreatePlan(
  plan: NativeCreatePlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeCreateExecutor;
  } = {},
): Promise<number> {
  const executor = options.executor ?? defaultNativeCreateExecutor;
  const env = options.env ?? process.env;
  try {
    await access(plan.targetDirectory);
    throw new TypeError(
      `Refusing to replace the existing create target: ${plan.targetDirectory}`,
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const scaffoldExitCode = await executor(plan, {
    env,
    output: "quiet-on-success",
  });
  if (scaffoldExitCode !== 0) {
    await removeNewCreateScaffold(
      plan.targetDirectory,
      new Error(
        `The upstream scaffold exited with status ${String(scaffoldExitCode)}.`,
      ),
    );
    return scaffoldExitCode;
  }
  const scaffold = await createdScaffoldStatus(plan.targetDirectory);
  if (scaffold === undefined || !scaffold.isDirectory()) {
    throw new TypeError(
      `The upstream scaffold completed without creating the expected directory: ${plan.targetDirectory}`,
    );
  }
  try {
    await applyNativeCreateTemplate(plan);
  } catch (error) {
    await removeNewCreateScaffold(plan.targetDirectory, error);
    throw error;
  }
  if (plan.installCommand === undefined) return 0;
  return executor(plan.installCommand, { env, output: "inherit" });
}

export async function executeNativeRunPlan(
  plan: NativeRunPlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeRunExecutor;
    readonly androidPreflight?: NativeAndroidRunPreflight;
    readonly androidRestore?: NativeAndroidRunRestore;
    readonly iosPreflight?: NativeIosRunPreflight;
  } = {},
): Promise<number> {
  const environment = { ...(options.env ?? process.env) };
  for (const [name, value] of Object.entries(plan.environmentDefaults ?? {})) {
    if (environment[name] === undefined) environment[name] = value;
  }
  if (plan.iosDestinationPreflight !== undefined) {
    await (options.iosPreflight ?? preflightNativeIosRunDestination)({
      selector: plan.iosDestinationPreflight,
      cwd: plan.projectRoot,
      env: environment,
    });
  }
  let androidResult: NativeAndroidRunPreflightResult | undefined;
  if (plan.androidDestinationPreflight !== undefined) {
    androidResult = await (
      options.androidPreflight ?? preflightNativeAndroidRunDestination
    )({
      selector: plan.androidDestinationPreflight,
      cwd: plan.projectRoot,
      env: environment,
    });
  }
  const executionPlan =
    plan.androidDestinationPreflight?.kind === "automatic" &&
    androidResult !== undefined
      ? {
          ...plan,
          args: [
            ...plan.args.slice(0, 2),
            "--device",
            androidResult.serial,
            ...plan.args.slice(2),
          ],
        }
      : plan;
  let exitCode: number | undefined;
  let executionError: unknown;
  try {
    exitCode = await (options.executor ?? defaultNativeRunExecutor)(
      executionPlan,
      {
        env: environment,
      },
    );
  } catch (error) {
    executionError = error;
  }
  let restoreError: unknown;
  if (androidResult !== undefined) {
    try {
      await (options.androidRestore ?? restoreNativeAndroidRunDestination)({
        result: androidResult,
        cwd: plan.projectRoot,
        env: environment,
      });
    } catch (error) {
      restoreError = error;
    }
  }
  if (executionError !== undefined && restoreError !== undefined) {
    throw new AggregateError(
      [executionError, restoreError],
      "The Android run failed and its device stay-awake lease could not be restored and released.",
    );
  }
  if (executionError !== undefined) throw executionError;
  if (restoreError !== undefined) throw restoreError;
  if (exitCode === undefined) {
    throw new TypeError("The native run executor returned no exit code.");
  }
  return exitCode;
}

export async function executeNativeBuildPlan(
  plan: NativeBuildPlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeBuildExecutor;
  } = {},
): Promise<number> {
  const environment = { ...(options.env ?? process.env) };
  for (const [name, value] of Object.entries(plan.environmentDefaults ?? {})) {
    if (environment[name] === undefined) environment[name] = value;
  }
  return (options.executor ?? defaultNativeBuildExecutor)(plan, {
    env: environment,
  });
}

export async function executeNativeBundlePlan(
  plan: NativeBundlePlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeBundleExecutor;
  } = {},
): Promise<number> {
  await Promise.all([
    mkdir(plan.outputDirectory, { recursive: true }),
    mkdir(plan.assetsDirectory, { recursive: true }),
  ]);
  const exitCode = await (options.executor ?? defaultNativeBundleExecutor)(
    plan,
    { env: options.env ?? process.env },
  );
  if (exitCode !== 0) return exitCode;
  let bundleMetadata;
  try {
    bundleMetadata = await stat(plan.bundlePath);
  } catch {
    throw new TypeError("Metro reported success without writing the bundle.");
  }
  if (!bundleMetadata.isFile() || bundleMetadata.size === 0) {
    throw new TypeError("Metro wrote an empty or non-regular bundle output.");
  }
  await canonicalizeNativeSourceMap(plan.sourceMapPath, plan.sourceRoot);
  await writeNativeBundleManifest({
    platform: plan.platform,
    entryPoint: plan.entryPoint,
    outputDirectory: plan.outputDirectory,
    bundlePath: plan.bundlePath,
    sourceMapPath: plan.sourceMapPath,
    assetsDirectory: plan.assetsDirectory,
    manifestPath: plan.manifestPath,
    minified: plan.minified,
  });
  return 0;
}

/** Checks one bounded Metro source graph against application-owned policy. */
export async function checkNativeBundleSources(
  options: NativeBundleSourcePolicyOptions,
): Promise<NativeSourceMapPolicyReport> {
  const dependencies = fileDependencies(options.dependencies);
  const resolvedCwd = path.resolve(options.cwd ?? process.cwd());
  const projectRoot = await findProjectRoot(
    resolvedCwd,
    dependencies.pathExists,
  );
  if (projectRoot === undefined) {
    throw new TypeError(
      `No package.json was found at or above ${resolvedCwd}.`,
    );
  }
  const lockfile = await findAncestorFile(
    projectRoot,
    "pnpm-lock.yaml",
    dependencies.pathExists,
  );
  if (lockfile === undefined) {
    throw new TypeError(
      "No pnpm-lock.yaml was found at or above the application; the source-map root is not reproducible.",
    );
  }
  const sourceRoot = path.dirname(lockfile);
  return verifyNativeSourceMapPolicy({
    sourceMapPath: path.resolve(projectRoot, options.sourceMapPath),
    sourceRoot,
    ...(options.requiredSources === undefined
      ? {}
      : { requiredSources: options.requiredSources }),
    ...(options.forbiddenSourceFragments === undefined
      ? {}
      : { forbiddenSourceFragments: options.forbiddenSourceFragments }),
  });
}

export async function executeNativeStartPlan(
  plan: NativeStartPlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeStartExecutor;
  } = {},
): Promise<number> {
  return (options.executor ?? defaultNativeStartExecutor)(plan, {
    env: options.env ?? process.env,
  });
}

export async function executeNativeTestPlan(
  plan: NativeTestPlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeTestExecutor;
  } = {},
): Promise<number> {
  return (options.executor ?? defaultNativeTestExecutor)(plan, {
    env: options.env ?? process.env,
  });
}

const SOLID_BINDING_LIBRARY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SOLID_BINDING_PACKAGE_NAME =
  /^(?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/u;

async function createSolidBindingInput(
  packageName: string,
  packageVersion: string | undefined,
  packageRoot: string,
  config: Readonly<Record<string, unknown>>,
  origin: NativeSolidBindingInput["origin"],
  dependencies: Pick<NativeGenerateFileDependencies, "pathExists" | "realPath">,
): Promise<NativeSolidBindingInput> {
  if (Array.isArray(config.libraries)) {
    throw new TypeError(
      `${packageName} uses the deprecated codegenConfig.libraries shape; migrate it to one React Native 0.87 Codegen config before generating Solid bindings.`,
    );
  }
  const kind = config.type;
  const libraryName = config.name;
  const jsSources = config.jsSrcsDir;
  if (kind !== "components" && kind !== "modules" && kind !== "all") {
    throw new TypeError(
      `${packageName} Codegen config must declare a components, modules, or all type.`,
    );
  }
  if (
    typeof libraryName !== "string" ||
    libraryName.length === 0 ||
    libraryName.length > 128 ||
    !SOLID_BINDING_LIBRARY_NAME.test(libraryName) ||
    typeof jsSources !== "string" ||
    jsSources.length === 0
  ) {
    throw new TypeError(
      `${packageName} Codegen config must declare an identifier name and a string jsSrcsDir.`,
    );
  }
  const sourcePath = path.resolve(packageRoot, jsSources);
  if (!pathContains(packageRoot, sourcePath)) {
    throw new TypeError(
      `${packageName} Solid Codegen source must stay inside its package root.`,
    );
  }
  if (!(await dependencies.pathExists(sourcePath))) {
    throw new TypeError(
      `${packageName} Solid Codegen source is missing at ${sourcePath}.`,
    );
  }
  const [physicalPackageRoot, physicalSourcePath] = await Promise.all([
    dependencies.realPath(packageRoot),
    dependencies.realPath(sourcePath),
  ]);
  if (!pathContains(physicalPackageRoot, physicalSourcePath)) {
    throw new TypeError(
      `${packageName} Solid Codegen source must remain inside its package root after resolving symlinks.`,
    );
  }
  return {
    origin,
    kind,
    libraryName,
    packageName,
    ...(packageVersion === undefined ? {} : { packageVersion }),
    sourcePath,
  };
}

function combinedSolidBindingKind(
  inputs: readonly NativeSolidBindingInput[],
): NativeSolidBindingKind {
  const first = inputs[0]?.kind;
  return first !== undefined && inputs.every((input) => input.kind === first)
    ? first
    : "all";
}

function assertSelectedSolidBindingInput(input: NativeSolidBindingInput): void {
  const schema = combineReactNativeCodegenSchemas([input.sourcePath], {
    libraryName: input.libraryName,
  });
  const audit = createSolidNativeSchemaAudit(schema);
  const componentCount =
    audit.components.length + audit.interfaceOnlyComponents.length;
  const moduleCount = audit.modules.length;
  const expectedCount =
    input.kind === "components"
      ? componentCount
      : input.kind === "modules"
        ? moduleCount
        : componentCount + moduleCount;
  if (expectedCount === 0) {
    throw new TypeError(
      `Selected Solid Codegen dependency ${input.packageName} declares a ${input.kind} config but its ${input.sourcePath} source exposes no matching Codegen surface. The package may contain a stale codegenConfig or a legacy native module rather than a generated binding.`,
    );
  }
}

async function createSolidBindingGeneration(
  application: NativeApplicationContext,
  options: NativeGenerateOptions,
  dependencies: NativeGenerateFileDependencies,
): Promise<NativeSolidBindingGeneration | undefined> {
  if (
    options.generateSolidBindings === false &&
    (options.solidOutputPath !== undefined ||
      (options.solidLibraries?.length ?? 0) > 0)
  ) {
    throw new TypeError(
      "solidOutputPath and solidLibraries cannot be combined with disabled Solid binding generation.",
    );
  }
  if (options.generateSolidBindings === false) return undefined;

  const inputs: NativeSolidBindingInput[] = [];
  const config = application.manifest.codegenConfig;
  if (config !== undefined) {
    const type = config.type;
    if (type === "components" || type === "modules" || type === "all") {
      inputs.push(
        await createSolidBindingInput(
          application.manifest.name ?? "application",
          application.manifest.version,
          application.projectRoot,
          config,
          "application",
          dependencies,
        ),
      );
    }
  }

  const requestedLibraries = options.solidLibraries ?? [];
  if (!Array.isArray(requestedLibraries)) {
    throw new TypeError("solidLibraries must be an array of package names.");
  }
  const uniqueLibraries = new Set<string>();
  for (const packageName of requestedLibraries) {
    if (
      typeof packageName !== "string" ||
      !SOLID_BINDING_PACKAGE_NAME.test(packageName)
    ) {
      throw new TypeError(
        `Invalid Solid Codegen dependency package name ${JSON.stringify(packageName)}.`,
      );
    }
    if (uniqueLibraries.has(packageName)) {
      throw new TypeError(
        `Solid Codegen dependency ${packageName} was requested more than once.`,
      );
    }
    uniqueLibraries.add(packageName);
    if (declaredVersion(application.manifest, packageName) === undefined) {
      throw new TypeError(
        `Solid Codegen dependency ${packageName} must be declared in the application package.json.`,
      );
    }
    const installed = await findInstalledPackageManifest(
      application.projectRoot,
      packageName,
      dependencies,
    );
    if (installed === undefined) {
      throw new TypeError(
        `Solid Codegen dependency ${packageName} is not installed.`,
      );
    }
    if (installed.manifest.name !== packageName) {
      throw new TypeError(
        `Installed Solid Codegen dependency ${packageName} has package name ${String(installed.manifest.name)}.`,
      );
    }
    if (installed.manifest.codegenConfig === undefined) {
      throw new TypeError(
        `Solid Codegen dependency ${packageName} does not declare codegenConfig.`,
      );
    }
    const input = await createSolidBindingInput(
      packageName,
      installed.manifest.version,
      path.dirname(installed.path),
      installed.manifest.codegenConfig,
      "dependency",
      dependencies,
    );
    assertSelectedSolidBindingInput(input);
    inputs.push(input);
  }

  if (inputs.length === 0) {
    if (options.solidOutputPath !== undefined) {
      throw new TypeError(
        "solidOutputPath requires an application or requested dependency Codegen config.",
      );
    }
    return undefined;
  }
  const outputPath = path.resolve(
    application.projectRoot,
    options.solidOutputPath ??
      path.join(
        "generated",
        inputs.length === 1
          ? `${inputs[0]!.libraryName}.ts`
          : "SolidNativeBindings.ts",
      ),
  );
  if (
    !pathContains(application.projectRoot, outputPath) ||
    outputPath === application.projectRoot ||
    path.extname(outputPath) !== ".ts"
  ) {
    throw new TypeError(
      "The Solid binding output must be a .ts file inside the application root.",
    );
  }
  await requirePhysicalOutputContainment(
    application.projectRoot,
    outputPath,
    "The Solid binding output",
    dependencies,
  );
  return {
    kind: combinedSolidBindingKind(inputs),
    inputs: Object.freeze(inputs),
    outputPath,
  };
}

export async function createNativeGeneratePlan(
  options: NativeGenerateOptions = {},
): Promise<NativeGeneratePlan> {
  const dependencies = fileDependencies(options.dependencies);
  const application = await resolveNativeApplication(options.cwd, dependencies);
  const platform = options.platform ?? "all";
  const requiredPlatforms: readonly NativeRunPlatform[] =
    platform === "all" ? ["ios", "android"] : [platform];
  for (const requiredPlatform of requiredPlatforms) {
    await requireNativeDirectory(
      application.projectRoot,
      requiredPlatform,
      dependencies.pathExists,
    );
  }
  const source = options.source ?? "app";
  const outputPath = path.resolve(
    application.projectRoot,
    options.outputPath ?? path.join("build", "solid-native-codegen"),
  );
  if (
    !pathContains(application.projectRoot, outputPath) ||
    outputPath === application.projectRoot
  ) {
    throw new TypeError(
      "The native Codegen output must be a directory inside the application root.",
    );
  }
  await requirePhysicalOutputContainment(
    application.projectRoot,
    outputPath,
    "The native Codegen output",
    dependencies,
  );
  const solidBindings = await createSolidBindingGeneration(
    application,
    options,
    dependencies,
  );
  if (
    solidBindings !== undefined &&
    (pathContains(outputPath, solidBindings.outputPath) ||
      pathContains(solidBindings.outputPath, outputPath))
  ) {
    throw new TypeError(
      "The native Codegen output and Solid binding output must not overlap.",
    );
  }
  return {
    schemaVersion: 0,
    operation: "generate",
    platform,
    source,
    projectRoot: application.projectRoot,
    command: process.execPath,
    args: [
      application.reactNativeCli,
      "codegen",
      "--path",
      application.projectRoot,
      "--platform",
      platform,
      "--source",
      source,
      "--outputPath",
      outputPath,
      ...(options.verbose === true ? ["--verbose"] : []),
    ],
    outputPath,
    ...(solidBindings === undefined ? {} : { solidBindings }),
  };
}

export const defaultNativeGenerateExecutor: NativeGenerateExecutor =
  spawnNativeProcess;

/** Deterministically renders the Solid-facing half of an inspected plan. */
export function generateNativeSolidBindingSource(
  generation: NativeSolidBindingGeneration,
): string {
  if (generation.inputs.length === 0) {
    throw new TypeError(
      "Solid binding generation requires at least one input.",
    );
  }
  const schema = combineReactNativeCodegenSchemas(
    generation.inputs.map((input) => input.sourcePath),
    {
      libraryName:
        generation.inputs.length === 1
          ? generation.inputs[0]!.libraryName
          : "SolidNativeBindings",
    },
  );
  const bindingSource =
    generation.kind === "components"
      ? generateSolidNativeComponentModule(schema)
      : generation.kind === "modules"
        ? generateSolidNativeTurboModuleBindings(schema)
        : generateSolidNativeBindingsModule(schema);
  const inputs = generation.inputs.map((input) => ({
    origin: input.origin,
    kind: input.kind,
    libraryName: input.libraryName,
    packageName: input.packageName,
    ...(input.packageVersion === undefined
      ? {}
      : { packageVersion: input.packageVersion }),
  }));
  const bindingSha256 = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 0,
        inputs,
        source: bindingSource,
      }),
    )
    .digest("hex");
  return [
    bindingSource.trimEnd(),
    "",
    "export const SOLID_NATIVE_BINDING_MANIFEST = Object.freeze({",
    "  schemaVersion: 0 as const,",
    `  bindingSha256: ${JSON.stringify(bindingSha256)},`,
    "  inputs: Object.freeze([",
    ...inputs.map((input) => `    Object.freeze(${JSON.stringify(input)}),`),
    "  ]),",
    "});",
    "",
  ].join("\n");
}

/** Checks a generated module without invoking or mutating native Codegen. */
export async function checkNativeSolidBindingGeneration(
  generation: NativeSolidBindingGeneration,
  options: {
    readonly readTextFile?: (target: string) => Promise<string>;
  } = {},
): Promise<NativeSolidBindingCheckReport> {
  const expected = generateNativeSolidBindingSource(generation);
  let actual: string;
  try {
    actual = await (
      options.readTextFile ?? ((target) => readFile(target, "utf8"))
    )(generation.outputPath);
  } catch (error) {
    return {
      schemaVersion: 0,
      ok: false,
      outputPath: generation.outputPath,
      status:
        (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
          ? "missing"
          : "unreadable",
    };
  }
  const ok = actual === expected;
  return {
    schemaVersion: 0,
    ok,
    outputPath: generation.outputPath,
    status: ok ? "match" : "stale",
  };
}

/** Builds a path-free compatibility inventory without evaluating wrappers. */
export function createNativeSolidBindingAudit(
  generation: NativeSolidBindingGeneration,
  options: { readonly platform?: NativeGeneratePlatform } = {},
): NativeSolidBindingAuditReport {
  if (generation.inputs.length === 0) {
    throw new TypeError("Solid binding audit requires at least one input.");
  }
  const platform =
    options.platform === undefined || options.platform === "all"
      ? undefined
      : options.platform;
  const schema = combineReactNativeCodegenSchemas(
    generation.inputs.map((input) => input.sourcePath),
    {
      libraryName:
        generation.inputs.length === 1
          ? generation.inputs[0]!.libraryName
          : "SolidNativeBindings",
      ...(platform === undefined ? {} : { platform }),
    },
  );
  const audit = createSolidNativeSchemaAudit(schema, {
    ...(platform === undefined ? {} : { platform }),
  });
  const inputs = generation.inputs.map((input) =>
    Object.freeze({
      origin: input.origin,
      kind: input.kind,
      libraryName: input.libraryName,
      packageName: input.packageName,
      ...(input.packageVersion === undefined
        ? {}
        : { packageVersion: input.packageVersion }),
    }),
  );
  return Object.freeze({
    ...audit,
    inputs: Object.freeze(inputs),
  });
}

/** Re-audits exact installed schemas against an application-owned catalog. */
export async function checkNativeCompatibilityCatalog(
  options: NativeCompatibilityCatalogOptions = {},
): Promise<NativeCompatibilityCatalogReport> {
  const dependencies = fileDependencies(options.dependencies);
  const application = await resolveNativeApplication(options.cwd, dependencies);
  const catalogPath = path.resolve(
    application.projectRoot,
    options.catalogPath ?? "solid-native.compatibility.json",
  );
  if (
    !pathContains(application.projectRoot, catalogPath) ||
    catalogPath === application.projectRoot
  ) {
    throw new TypeError(
      "The compatibility catalog must be a file inside the application root.",
    );
  }
  await requirePhysicalOutputContainment(
    application.projectRoot,
    catalogPath,
    "The compatibility catalog",
    dependencies,
  );
  const catalog = parseNativeCompatibilityCatalog(
    await dependencies.readTextFile(catalogPath),
  );
  const platform = options.platform ?? "all";
  const plan = await createNativeGeneratePlan({
    cwd: application.projectRoot,
    platform,
    solidLibraries: catalog.packages.map((entry) => entry.packageName),
    dependencies,
  });
  if (plan.solidBindings === undefined) {
    throw new TypeError(
      "The compatibility catalog requires at least one Codegen input.",
    );
  }
  const platforms =
    platform === "all" ? (["android", "ios"] as const) : ([platform] as const);
  const packageAudits = catalog.packages.map((entry) => {
    const input = plan.solidBindings!.inputs.find(
      (candidate) =>
        candidate.origin === "dependency" &&
        candidate.packageName === entry.packageName,
    );
    if (input === undefined) {
      throw new TypeError(
        `No dependency Codegen input was discovered for ${entry.packageName}.`,
      );
    }
    const generation: NativeSolidBindingGeneration = {
      kind: input.kind,
      inputs: Object.freeze([input]),
      outputPath: plan.solidBindings!.outputPath,
    };
    const audits: Partial<
      Record<"android" | "ios", NativeSolidBindingAuditReport>
    > = {};
    for (const target of platforms) {
      audits[target] = createNativeSolidBindingAudit(generation, {
        platform: target,
      });
    }
    return Object.freeze({
      packageName: entry.packageName,
      audits: Object.freeze(audits),
    });
  });
  const catalogFile = path
    .relative(application.projectRoot, catalogPath)
    .split(path.sep)
    .join("/");
  const evidenceDigests = new Map<string, Promise<string | undefined>>();
  return verifyNativeCompatibilityCatalog(catalog, {
    catalogFile,
    platform,
    packageAudits: Object.freeze(packageAudits),
    evidenceSha256(reference) {
      const existing = evidenceDigests.get(reference);
      if (existing !== undefined) return existing;
      const digest = (async (): Promise<string | undefined> => {
        const target = path.resolve(application.projectRoot, reference);
        if (!pathContains(application.projectRoot, target)) return undefined;
        try {
          await requirePhysicalOutputContainment(
            application.projectRoot,
            target,
            "Compatibility evidence",
            dependencies,
          );
        } catch {
          return undefined;
        }
        if (!(await dependencies.pathExists(target))) return undefined;
        try {
          if (!(await stat(target)).isFile()) return undefined;
          return createHash("sha256")
            .update(await readFile(target))
            .digest("hex");
        } catch {
          return undefined;
        }
      })();
      evidenceDigests.set(reference, digest);
      return digest;
    },
  });
}

/** Hashes contained application files into ready-to-review catalog entries. */
export async function createNativeCompatibilityEvidenceReport(
  options: NativeCompatibilityEvidenceOptions,
): Promise<NativeCompatibilityEvidenceReport> {
  if (
    typeof options !== "object" ||
    options === null ||
    !Array.isArray(options.paths) ||
    options.paths.length === 0 ||
    options.paths.length > 16
  ) {
    throw new TypeError("Compatibility evidence requires 1-16 file paths.");
  }
  const dependencies = fileDependencies(options.dependencies);
  const application = await resolveNativeApplication(options.cwd, dependencies);
  const evidence: NativeCompatibilityEvidence[] = [];
  const seen = new Set<string>();
  for (const reference of options.paths) {
    if (
      typeof reference !== "string" ||
      reference.length === 0 ||
      reference.length > 512 ||
      /[\0\r\n]/u.test(reference)
    ) {
      throw new TypeError(
        "Compatibility evidence paths must be 1-512 character strings without control lines.",
      );
    }
    const target = path.resolve(application.projectRoot, reference);
    if (
      !pathContains(application.projectRoot, target) ||
      target === application.projectRoot
    ) {
      throw new TypeError(
        `Compatibility evidence must be a file inside the application root: ${reference}.`,
      );
    }
    await requirePhysicalOutputContainment(
      application.projectRoot,
      target,
      "Compatibility evidence",
      dependencies,
    );
    if (!(await dependencies.pathExists(target))) {
      throw new TypeError(
        `Compatibility evidence does not exist: ${reference}.`,
      );
    }
    if (!(await stat(target)).isFile()) {
      throw new TypeError(
        `Compatibility evidence is not a file: ${reference}.`,
      );
    }
    const portablePath = path
      .relative(application.projectRoot, target)
      .split(path.sep)
      .join("/");
    const entry = parseNativeCompatibilityEvidence({
      path: portablePath,
      sha256: createHash("sha256")
        .update(await readFile(target))
        .digest("hex"),
    });
    if (seen.has(entry.path)) {
      throw new TypeError(
        `Compatibility evidence path was requested more than once: ${entry.path}.`,
      );
    }
    seen.add(entry.path);
    evidence.push(entry);
  }
  return Object.freeze({
    schemaVersion: 0,
    projectRoot: application.projectRoot,
    evidence: Object.freeze(evidence),
  });
}

function nativeAdapterBindingsImport(
  adapterOutputPath: string,
  bindingsOutputPath: string,
): string {
  let relative = path
    .relative(path.dirname(adapterOutputPath), bindingsOutputPath)
    .split(path.sep)
    .join("/");
  relative = relative.slice(0, -path.extname(relative).length);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** Plans one editable policy-gated adapter without writing application files. */
export async function createNativeAdapterScaffoldPlan(
  options: NativeAdapterScaffoldOptions,
): Promise<NativeAdapterScaffoldPlan> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Native adapter scaffold options must be an object.");
  }
  const dependencies = fileDependencies(options.dependencies);
  const platform = options.platform ?? "all";
  const generationPlan = await createNativeGeneratePlan({
    platform,
    solidLibraries: [options.packageName],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.bindingsPath === undefined
      ? {}
      : { solidOutputPath: options.bindingsPath }),
    dependencies,
  });
  const bindingGeneration = generationPlan.solidBindings;
  if (bindingGeneration === undefined) {
    throw new TypeError(
      "Native adapter scaffolding requires a dependency Codegen input.",
    );
  }
  const input = bindingGeneration.inputs.find(
    (candidate) =>
      candidate.origin === "dependency" &&
      candidate.packageName === options.packageName,
  );
  if (input === undefined) {
    throw new TypeError(
      `No dependency Codegen input was discovered for ${options.packageName}.`,
    );
  }
  if (input.kind === "components") {
    throw new TypeError(
      `Solid adapter scaffolding requires a TurboModule schema; ${options.packageName} declares components only.`,
    );
  }
  const outputPath = path.resolve(
    generationPlan.projectRoot,
    options.outputPath ?? path.join("adapters", `${options.moduleName}.ts`),
  );
  if (
    !pathContains(generationPlan.projectRoot, outputPath) ||
    outputPath === generationPlan.projectRoot ||
    path.extname(outputPath) !== ".ts"
  ) {
    throw new TypeError(
      "The native adapter scaffold output must be a .ts file inside the application root.",
    );
  }
  await requirePhysicalOutputContainment(
    generationPlan.projectRoot,
    outputPath,
    "The native adapter scaffold output",
    dependencies,
  );
  if (outputPath === bindingGeneration.outputPath) {
    throw new TypeError(
      "The native adapter scaffold output must differ from its generated binding module.",
    );
  }
  const bindingsImport = nativeAdapterBindingsImport(
    outputPath,
    bindingGeneration.outputPath,
  );
  const schema = combineReactNativeCodegenSchemas([input.sourcePath], {
    libraryName: input.libraryName,
    ...(platform === "all" ? {} : { platform }),
  });
  const source = generateSolidNativeTurboModuleAdapterScaffold(schema, {
    moduleName: options.moduleName,
    bindingsImport,
    ...(platform === "all" ? {} : { platform }),
  });
  return {
    schemaVersion: 0,
    operation: "adapter-create",
    platform,
    projectRoot: generationPlan.projectRoot,
    packageName: input.packageName,
    ...(input.packageVersion === undefined
      ? {}
      : { packageVersion: input.packageVersion }),
    libraryName: input.libraryName,
    moduleName: options.moduleName,
    outputPath,
    bindingsImport,
    bindingGeneration,
    source,
  };
}

/** Creates a scaffold exactly once after verifying its generated ABI input. */
export async function executeNativeAdapterScaffoldPlan(
  plan: NativeAdapterScaffoldPlan,
): Promise<void> {
  const binding = await checkNativeSolidBindingGeneration(
    plan.bindingGeneration,
  );
  if (!binding.ok) {
    throw new TypeError(
      `Generated Solid bindings are ${binding.status}; run solid-native generate --solid-library ${plan.packageName} before scaffolding its adapter.`,
    );
  }
  await mkdir(path.dirname(plan.outputPath), { recursive: true });
  const temporaryPath = `${plan.outputPath}.solid-native-${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, plan.source, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    await link(temporaryPath, plan.outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
      throw new TypeError(
        `Native adapter scaffold already exists at ${plan.outputPath}; refusing to overwrite application-owned policy code.`,
      );
    }
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

interface StagedNativeGenerateOutput {
  readonly finalPath: string;
  readonly stagedPath: string;
  readonly backupPath: string;
}

function nativeGenerateStagingPlan(
  plan: NativeGeneratePlan,
  outputPath: string,
): NativeGeneratePlan {
  const flagIndex = plan.args.lastIndexOf("--outputPath");
  if (
    flagIndex < 0 ||
    flagIndex + 1 >= plan.args.length ||
    plan.args[flagIndex + 1] !== plan.outputPath
  ) {
    throw new TypeError(
      "Native Codegen plan output does not match its command arguments.",
    );
  }
  const args = [...plan.args];
  args[flagIndex + 1] = outputPath;
  return {
    ...plan,
    args: Object.freeze(args),
    outputPath,
  };
}

async function onDisk(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function publishNativeGenerateOutputs(
  outputs: readonly StagedNativeGenerateOutput[],
): Promise<void> {
  const backedUp = new Set<string>();
  const published = new Set<string>();
  try {
    for (const output of outputs) {
      if (await onDisk(output.finalPath)) {
        await rename(output.finalPath, output.backupPath);
        backedUp.add(output.finalPath);
      }
    }
    for (const output of outputs) {
      await rename(output.stagedPath, output.finalPath);
      published.add(output.finalPath);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const output of [...outputs].reverse()) {
      try {
        if (published.has(output.finalPath)) {
          await rm(output.finalPath, { force: true, recursive: true });
        }
        if (backedUp.has(output.finalPath)) {
          await rename(output.backupPath, output.finalPath);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Native Codegen output publication failed and could not be fully rolled back.",
      );
    }
    throw error;
  }

  for (const output of outputs) {
    if (backedUp.has(output.finalPath)) {
      await rm(output.backupPath, { force: true, recursive: true });
    }
  }
}

export async function executeNativeGeneratePlan(
  plan: NativeGeneratePlan,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly executor?: NativeGenerateExecutor;
  } = {},
): Promise<number> {
  const transactionId = randomUUID();
  const nativeOutput: StagedNativeGenerateOutput = {
    finalPath: plan.outputPath,
    stagedPath: `${plan.outputPath}.solid-native-${transactionId}.tmp`,
    backupPath: `${plan.outputPath}.solid-native-${transactionId}.bak`,
  };
  const solidOutput =
    plan.solidBindings === undefined
      ? undefined
      : ({
          finalPath: plan.solidBindings.outputPath,
          stagedPath: `${plan.solidBindings.outputPath}.solid-native-${transactionId}.tmp`,
          backupPath: `${plan.solidBindings.outputPath}.solid-native-${transactionId}.bak`,
        } satisfies StagedNativeGenerateOutput);
  const outputs =
    solidOutput === undefined ? [nativeOutput] : [nativeOutput, solidOutput];
  await Promise.all(
    outputs.map((output) =>
      mkdir(path.dirname(output.stagedPath), { recursive: true }),
    ),
  );
  try {
    if (solidOutput !== undefined && plan.solidBindings !== undefined) {
      await writeFile(
        solidOutput.stagedPath,
        generateNativeSolidBindingSource(plan.solidBindings),
        { encoding: "utf8", mode: 0o644 },
      );
    }
    const exitCode = await (options.executor ?? defaultNativeGenerateExecutor)(
      nativeGenerateStagingPlan(plan, nativeOutput.stagedPath),
      {
        env: options.env ?? process.env,
      },
    );
    if (exitCode !== 0) return exitCode;
    // An application without a Codegen schema can legitimately produce no
    // directory. Publishing an empty one still removes any prior stale tree.
    await mkdir(nativeOutput.stagedPath, { recursive: true });
    await publishNativeGenerateOutputs(outputs);
    return 0;
  } finally {
    await Promise.all(
      outputs.map((output) =>
        rm(output.stagedPath, { force: true, recursive: true }),
      ),
    );
  }
}

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(argument)
    ? argument
    : `'${argument.replaceAll("'", `'\\''`)}'`;
}

export function formatNativeRunPlan(plan: NativeRunPlan): string {
  const environment = Object.entries(plan.environmentDefaults ?? {}).map(
    ([name, value]) => `${name}=${quoteArgument(value)}`,
  );
  const command = [plan.command, ...plan.args].map(quoteArgument);
  return [...environment, ...command].join(" ");
}

export function formatNativeBuildPlan(plan: NativeBuildPlan): string {
  const environment = Object.entries(plan.environmentDefaults ?? {}).map(
    ([name, value]) => `${name}=${quoteArgument(value)}`,
  );
  const command = [plan.command, ...plan.args].map(quoteArgument);
  return [...environment, ...command].join(" ");
}

export function formatNativeBundlePlan(plan: NativeBundlePlan): string {
  return [plan.command, ...plan.args].map(quoteArgument).join(" ");
}

export function formatNativeStartPlan(plan: NativeStartPlan): string {
  return [plan.command, ...plan.args].map(quoteArgument).join(" ");
}

export function formatNativeCreatePlan(plan: NativeCreatePlan): string {
  const scaffold = [plan.command, ...plan.args].map(quoteArgument).join(" ");
  if (plan.installCommand === undefined) return scaffold;
  const install = [plan.installCommand.command, ...plan.installCommand.args]
    .map(quoteArgument)
    .join(" ");
  return `${scaffold}\nThen in ${quoteArgument(plan.targetDirectory)}: ${install}`;
}

export function formatNativeCreateSuccess(plan: NativeCreatePlan): string {
  return [
    `Created ${plan.projectName} at ${plan.targetDirectory}.`,
    "",
    "Next:",
    `  cd ${quoteArgument(plan.targetDirectory)}`,
    ...(plan.installCommand === undefined ? ["  pnpm install"] : []),
    "  pnpm run doctor",
    "  pnpm start",
  ].join("\n");
}

export function formatNativeGeneratePlan(plan: NativeGeneratePlan): string {
  return [plan.command, ...plan.args].map(quoteArgument).join(" ");
}

export function formatDoctorReport(report: DoctorReport): string {
  const symbols: Record<DoctorCheckStatus, string> = {
    pass: "✓",
    warn: "!",
    fail: "✗",
    skip: "–",
  };
  const lines = [
    "Solid Native doctor",
    `Project: ${report.projectRoot}`,
    "",
    ...report.checks.flatMap((entry) => [
      `${symbols[entry.status]} ${entry.label}: ${entry.message}`,
      ...(entry.remediation === undefined
        ? []
        : [`  Fix: ${entry.remediation}`]),
    ]),
    "",
    `${report.ok ? "Ready" : "Not ready"}: ${report.summary.pass} passed, ${report.summary.warn} ${report.summary.warn === 1 ? "warning" : "warnings"}, ${report.summary.fail} failed, ${report.summary.skip} skipped.`,
  ];
  return lines.join("\n");
}
