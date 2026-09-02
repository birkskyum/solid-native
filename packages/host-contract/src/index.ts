export const HOST_CONTRACT_VERSION = 1 as const;

export type SurfaceId = number;
export type NodeHandle = number;
export type CommitSequence = number;

export type HostPrimitive = string | number | boolean | null;
export type HostValue =
  HostPrimitive | readonly HostValue[] | { readonly [key: string]: HostValue };

export type HostProps = Readonly<Record<string, HostValue>>;

export type CommitPriority =
  "immediate" | "user-blocking" | "normal" | "background";

export const HOST_CAUSAL_OPERATION_ID_MAX_LENGTH = 128;

export interface HostCausalContext {
  /** Opaque, process-local correlation ID. It must not contain user data. */
  readonly operationId: string;
}

export interface SurfaceOptions {
  readonly name: string;
  readonly initialProps?: HostProps;
}

export interface HostCapabilities {
  readonly contractVersion: typeof HOST_CONTRACT_VERSION;
  readonly synchronousMeasurement: boolean;
  readonly bubblingEvents: boolean;
  readonly nativeScreens: boolean;
  readonly uiWorklets: boolean;
  /**
   * The host exposes renderer-visible reusable node identities. Platform-owned
   * pooling beneath ordinary create/delete mutations does not set this flag.
   */
  readonly viewRecycling: boolean;
  readonly commitMountEvents: boolean;
}

export type HostMutation =
  | {
      readonly type: "create-element";
      readonly node: NodeHandle;
      readonly component: string;
      readonly props: HostProps;
    }
  | {
      readonly type: "create-text";
      readonly node: NodeHandle;
      readonly text: string;
    }
  | {
      readonly type: "update-props";
      readonly node: NodeHandle;
      readonly props: HostProps;
      readonly removedProps: readonly string[];
    }
  | {
      readonly type: "update-text";
      readonly node: NodeHandle;
      readonly text: string;
    }
  | {
      readonly type: "update-event-listeners";
      readonly node: NodeHandle;
      /** Sorted, unique semantic event names currently observed by JavaScript. */
      readonly events: readonly string[];
    }
  | {
      readonly type: "insert-child";
      readonly parent: NodeHandle;
      readonly child: NodeHandle;
      readonly before?: NodeHandle;
    }
  | {
      readonly type: "remove-child";
      readonly parent: NodeHandle;
      readonly child: NodeHandle;
    }
  | {
      readonly type: "delete-node";
      readonly node: NodeHandle;
    }
  | {
      readonly type: "command";
      readonly node: NodeHandle;
      readonly command: string;
      readonly args: readonly HostValue[];
    };

export interface HostCommit {
  readonly surface: SurfaceId;
  readonly sequence: CommitSequence;
  readonly priority: CommitPriority;
  readonly mutations: readonly HostMutation[];
  readonly causalContext?: HostCausalContext;
}

export interface HostCommitResult {
  readonly surface: SurfaceId;
  readonly sequence: CommitSequence;
  /** True once the transaction has entered the backend's mounting pipeline. */
  readonly mounted: boolean;
  /** Exact backend revision when this commit produced one. */
  readonly hostRevision?: number;
}

export interface HostCommitMountedEvent {
  readonly type: "commit-mounted";
  readonly surface: SurfaceId;
  readonly sequence: CommitSequence;
  readonly hostRevision: number;
  /** Milliseconds since the Unix epoch at backend commit ingress. */
  readonly commitStartedAt: number;
  /** Milliseconds since the Unix epoch when the platform mount completed. */
  readonly mountedAt: number;
  /** Monotonic elapsed milliseconds from commit ingress through mount. */
  readonly mountLatency: number;
  readonly causalContext?: HostCausalContext;
}

/**
 * The first platform display callback observed after a mounted revision.
 * This is a next-vsync boundary, not proof that the compositor presented
 * particular pixels on screen.
 */
export interface HostCommitFrameEvent {
  readonly type: "commit-frame";
  readonly surface: SurfaceId;
  readonly sequence: CommitSequence;
  readonly hostRevision: number;
  /** Milliseconds since the Unix epoch when the platform mount completed. */
  readonly mountedAt: number;
  /** Milliseconds since the Unix epoch at the next platform frame callback. */
  readonly frameStartedAt: number;
  /** Monotonic elapsed milliseconds from commit ingress to the frame callback. */
  readonly frameLatency: number;
  /** Monotonic elapsed milliseconds from mount completion to the frame callback. */
  readonly mountToFrameLatency: number;
  readonly causalContext?: HostCausalContext;
}

export type HostLifecycleEvent = HostCommitMountedEvent | HostCommitFrameEvent;
export type HostLifecycleListener = (event: HostLifecycleEvent) => void;

export type NativeEventPriority = "discrete" | "continuous" | "default";

export interface NativeEvent {
  readonly surface: SurfaceId;
  readonly target: NodeHandle;
  readonly observedSequence: CommitSequence;
  readonly name: string;
  readonly timestamp: number;
  readonly priority: NativeEventPriority;
  readonly bubbles: boolean;
  readonly coalescible: boolean;
  readonly payload: HostValue;
}

export interface NativeMeasurement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly observedSequence: CommitSequence;
}

export interface NativeComponentDescriptor {
  readonly name: string;
  readonly acceptsRawText: boolean;
  readonly bubblingEvents: readonly string[];
  readonly directEvents: readonly string[];
  readonly commands: Readonly<Record<string, readonly string[]>>;
}

export type NativeEventListener = (event: NativeEvent) => void;

export interface NativeHost {
  /** Stable platform identifier used by portable facades with native lifecycle differences. */
  readonly platform: string;
  readonly capabilities: HostCapabilities;

  createSurface(options: SurfaceOptions): SurfaceId;
  destroySurface(surface: SurfaceId): void | Promise<void>;

  allocateNode(surface: SurfaceId): NodeHandle;
  commit(transaction: HostCommit): HostCommitResult | Promise<HostCommitResult>;

  measure(
    surface: SurfaceId,
    node: NodeHandle,
    afterSequence?: CommitSequence,
  ): NativeMeasurement | Promise<NativeMeasurement>;

  subscribe(listener: NativeEventListener): () => void;
  subscribeLifecycle?(listener: HostLifecycleListener): () => void;

  getComponentDescriptor(name: string): NativeComponentDescriptor | undefined;
}

export type HostCapabilityName = Exclude<
  keyof HostCapabilities,
  "contractVersion"
>;

export interface HostRequirements {
  readonly components?: readonly string[];
  readonly capabilities?: readonly HostCapabilityName[];
}

export interface NativeHostFingerprint {
  readonly contractVersion: number;
  readonly platform: string;
  readonly capabilities: HostCapabilities;
  readonly availableComponents: readonly string[];
}

/** @deprecated Use the framework-neutral `NativeHostFingerprint` name. */
export type RuntimeFingerprint = NativeHostFingerprint;

export interface HostValidationReport {
  readonly compatible: boolean;
  readonly issues: readonly string[];
  readonly fingerprint: NativeHostFingerprint;
}

export class IncompatibleHostError extends Error {
  readonly report: HostValidationReport;

  constructor(report: HostValidationReport) {
    super(`Incompatible native host: ${report.issues.join(" ")}`);
    this.name = "IncompatibleHostError";
    this.report = report;
  }
}

/**
 * Inspects a host without starting a surface so framework adapters can fail
 * before allocating native application state.
 */
export function inspectHost(
  host: NativeHost,
  requirements: HostRequirements = {},
): HostValidationReport {
  const requestedComponents = [
    ...new Set(requirements.components ?? []),
  ].sort();
  const availableComponents = requestedComponents.filter(
    (component) => host.getComponentDescriptor(component) !== undefined,
  );
  const issues: string[] = [];

  if (typeof host.platform !== "string" || host.platform.length === 0) {
    issues.push("The host platform identifier is unavailable.");
  }

  if (host.capabilities.contractVersion !== HOST_CONTRACT_VERSION) {
    issues.push(
      `Expected host contract ${HOST_CONTRACT_VERSION}, received ${String(host.capabilities.contractVersion)}.`,
    );
  }
  for (const capability of requirements.capabilities ?? []) {
    if (!host.capabilities[capability]) {
      issues.push(`Required capability ${capability} is unavailable.`);
    }
  }
  for (const component of requestedComponents) {
    if (!availableComponents.includes(component)) {
      issues.push(`Required native component ${component} is unavailable.`);
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
    fingerprint: {
      contractVersion: host.capabilities.contractVersion,
      platform: host.platform,
      capabilities: { ...host.capabilities },
      availableComponents,
    },
  };
}

export function assertCompatibleHost(
  host: NativeHost,
  requirements: HostRequirements = {},
): NativeHostFingerprint {
  const report = inspectHost(host, requirements);
  if (!report.compatible) throw new IncompatibleHostError(report);
  return report.fingerprint;
}

/** @deprecated Use the framework-neutral `NativeHost` name. */
export type SolidNativeHost = NativeHost;
