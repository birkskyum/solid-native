import {
  HOST_CONTRACT_VERSION,
  type HostCapabilities,
  type HostCommit,
  type HostCommitResult,
  type HostLifecycleEvent,
  type HostLifecycleListener,
  type NativeComponentDescriptor,
  type NativeEvent,
  type NativeEventListener,
  type NativeMeasurement,
  type NodeHandle,
  type NativeHost,
  type SurfaceId,
  type SurfaceOptions,
} from "@solid-native/host-contract";

import {
  commitNativeHostTransaction,
  getNativeHostBinding,
  measureNativeHostNode,
  readNativeSurfaceInfo,
  subscribeToNativeHostCommitLifecycle,
  subscribeToNativeHostEvents,
  supportsNativeUIWorklets,
  type NativeFabricBinding,
} from "./native-binding.js";

export interface NativeFabricHostOptions {
  readonly descriptors: readonly NativeComponentDescriptor[];
  readonly binding?: NativeFabricBinding;
}

const TEARDOWN_POLL_INTERVAL_MS = 10;
const MAX_TEARDOWN_POLL_ATTEMPTS = 500;
const ACTIVE_NATIVE_FABRIC_HOSTS = new WeakMap<
  NativeFabricBinding,
  NativeFabricHost
>();

export class NativeFabricSurfaceOwnershipError extends Error {
  constructor() {
    super("The native Fabric binding is already owned by another active host.");
    this.name = "NativeFabricSurfaceOwnershipError";
  }
}

function waitForReclamationPoll(): Promise<void> {
  return new Promise((resolve) => {
    const timers = globalThis as typeof globalThis & {
      setTimeout(callback: () => void, delay: number): unknown;
    };
    timers.setTimeout(resolve, TEARDOWN_POLL_INTERVAL_MS);
  });
}

/**
 * Adapts the single Fabric surface owned by the native application shell to
 * the framework-neutral host contract. One adapter intentionally supports one
 * root for one runtime; a disposed surface cannot be reopened with stale node
 * identities.
 */
export class NativeFabricHost implements NativeHost {
  readonly platform: "android" | "ios";
  readonly capabilities: HostCapabilities;
  readonly binding: NativeFabricBinding;

  readonly #descriptors = new Map<string, NativeComponentDescriptor>();
  readonly #listeners = new Set<NativeEventListener>();
  readonly #lifecycleListeners = new Set<HostLifecycleListener>();
  readonly #createdNodes = new Set<NodeHandle>();
  #surface: SurfaceId | undefined;
  #nextNode: NodeHandle = 1;
  #detachNativeEvents: (() => void) | undefined;
  #detachNativeLifecycle: (() => void) | undefined;
  #destroying = false;
  #destroyed = false;

  constructor(options: NativeFabricHostOptions) {
    this.binding = options.binding ?? getNativeHostBinding();
    this.platform = this.binding.platform;
    for (const descriptor of options.descriptors) {
      if (this.#descriptors.has(descriptor.name)) {
        throw new Error(
          `Duplicate native component descriptor: ${descriptor.name}.`,
        );
      }
      this.#descriptors.set(descriptor.name, descriptor);
    }
    if (!this.#descriptors.has("RootView")) {
      throw new Error("The native Fabric host requires a RootView descriptor.");
    }
    this.capabilities = Object.freeze({
      contractVersion: HOST_CONTRACT_VERSION,
      synchronousMeasurement: true,
      bubblingEvents: true,
      nativeScreens:
        this.#descriptors.has("Screen") && this.#descriptors.has("ScreenStack"),
      uiWorklets: supportsNativeUIWorklets(this.binding),
      viewRecycling: false,
      commitMountEvents:
        typeof this.binding.setCommitLifecycleHandler === "function",
    });
  }

  createSurface(_options: SurfaceOptions): SurfaceId {
    if (this.#destroyed) {
      throw new Error("The native Fabric host has been destroyed.");
    }
    if (this.#surface !== undefined) {
      throw new Error("The native Fabric runtime only supports one surface.");
    }
    const owner = ACTIVE_NATIVE_FABRIC_HOSTS.get(this.binding);
    if (owner !== undefined && owner !== this) {
      throw new NativeFabricSurfaceOwnershipError();
    }
    ACTIVE_NATIVE_FABRIC_HOSTS.set(this.binding, this);
    try {
      const info = readNativeSurfaceInfo(this.binding);
      if (!info.ready) {
        throw new Error("The native Fabric surface is not ready.");
      }
      if (
        info.sequence !== 0 ||
        info.retainedNodeCount !== 0 ||
        info.retainedResourceCount !== 0 ||
        (info.activeUIWorkletCount ?? 0) !== 0
      ) {
        throw new Error(
          "The native Fabric surface is not empty at JavaScript ownership transfer.",
        );
      }
      this.#surface = info.surface;
      return info.surface;
    } catch (error) {
      if (ACTIVE_NATIVE_FABRIC_HOSTS.get(this.binding) === this) {
        ACTIVE_NATIVE_FABRIC_HOSTS.delete(this.binding);
      }
      throw error;
    }
  }

  destroySurface(surface: SurfaceId): void | Promise<void> {
    this.#assertSurface(surface);
    if (this.#createdNodes.size !== 0) {
      throw new Error(
        `Cannot destroy a native Fabric surface with ${this.#createdNodes.size} live nodes.`,
      );
    }
    const info = readNativeSurfaceInfo(this.binding);
    if (info.surface !== surface || !info.ready) {
      throw new Error(
        "The native Fabric surface became unavailable during teardown.",
      );
    }
    if (info.retainedResourceCount !== 0) {
      throw new Error(
        `Cannot destroy a native Fabric surface with ${info.retainedResourceCount} retained native resources.`,
      );
    }
    if ((info.activeUIWorkletCount ?? 0) !== 0) {
      throw new Error(
        `Cannot destroy a native Fabric surface with ${String(info.activeUIWorkletCount)} active UI worklets.`,
      );
    }
    this.#destroying = true;
    if (info.retainedNodeCount !== 0) {
      return this.#destroyWhenReclaimed(surface);
    }

    return this.#finishDestroySurface(surface);
  }

  async #destroyWhenReclaimed(surface: SurfaceId): Promise<void> {
    try {
      for (let attempt = 0; attempt < MAX_TEARDOWN_POLL_ATTEMPTS; attempt++) {
        await waitForReclamationPoll();
        const info = readNativeSurfaceInfo(this.binding);
        if (info.surface !== surface || !info.ready) {
          throw new Error(
            "The native Fabric surface became unavailable during identity reclamation.",
          );
        }
        if (info.retainedResourceCount !== 0) {
          throw new Error(
            `Cannot destroy a native Fabric surface with ${info.retainedResourceCount} retained native resources.`,
          );
        }
        if ((info.activeUIWorkletCount ?? 0) !== 0) {
          throw new Error(
            `Cannot destroy a native Fabric surface with ${String(info.activeUIWorkletCount)} active UI worklets.`,
          );
        }
        if (info.retainedNodeCount === 0) {
          break;
        }
        if (attempt === MAX_TEARDOWN_POLL_ATTEMPTS - 1) {
          throw new Error(
            "Timed out waiting for Fabric to reclaim retired native node identities.",
          );
        }
      }
    } catch (error) {
      this.#destroying = false;
      throw error;
    }
    await this.#finishDestroySurface(surface);
  }

  async #finishDestroySurface(surface: SurfaceId): Promise<void> {
    this.#detachNativeEvents?.();
    this.#detachNativeEvents = undefined;
    this.#detachNativeLifecycle?.();
    this.#detachNativeLifecycle = undefined;
    this.#listeners.clear();
    this.#lifecycleListeners.clear();
    let destroyRequested = false;
    try {
      this.binding.destroySurface();
      destroyRequested = true;
      for (let attempt = 0; attempt < MAX_TEARDOWN_POLL_ATTEMPTS; attempt++) {
        const info = readNativeSurfaceInfo(this.binding);
        if (!info.ready) {
          this.#surface = undefined;
          this.#destroying = false;
          this.#destroyed = true;
          if (ACTIVE_NATIVE_FABRIC_HOSTS.get(this.binding) === this) {
            ACTIVE_NATIVE_FABRIC_HOSTS.delete(this.binding);
          }
          return;
        }
        if (info.surface !== surface) {
          throw new Error(
            "The native Fabric binding published a different surface during teardown.",
          );
        }
        await waitForReclamationPoll();
      }
      throw new Error(
        "Timed out waiting for the native Fabric surface to stop.",
      );
    } catch (error) {
      if (!destroyRequested) this.#destroying = false;
      throw error;
    }
  }

  allocateNode(surface: SurfaceId): NodeHandle {
    this.#assertSurface(surface);
    if (!Number.isSafeInteger(this.#nextNode)) {
      throw new Error("The native node handle space is exhausted.");
    }
    return this.#nextNode++;
  }

  commit(transaction: HostCommit): HostCommitResult {
    this.#assertSurface(transaction.surface);
    const result = commitNativeHostTransaction(this.binding, transaction);
    for (const mutation of transaction.mutations) {
      if (
        mutation.type === "create-element" ||
        mutation.type === "create-text"
      ) {
        this.#createdNodes.add(mutation.node);
      } else if (mutation.type === "delete-node") {
        this.#createdNodes.delete(mutation.node);
      }
    }
    return result;
  }

  measure(
    surface: SurfaceId,
    node: NodeHandle,
    afterSequence: number = 0,
  ): NativeMeasurement {
    this.#assertSurface(surface);
    return measureNativeHostNode(this.binding, node, afterSequence);
  }

  subscribe(listener: NativeEventListener): () => void {
    if (this.#surface === undefined || this.#destroyed || this.#destroying) {
      throw new Error("Cannot subscribe without an active native surface.");
    }
    this.#listeners.add(listener);
    if (this.#detachNativeEvents === undefined) {
      this.#detachNativeEvents = subscribeToNativeHostEvents(
        this.binding,
        (event) => this.#dispatchEvent(event),
      );
    }

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#detachNativeEvents?.();
        this.#detachNativeEvents = undefined;
      }
    };
  }

  subscribeLifecycle(listener: HostLifecycleListener): () => void {
    if (this.#surface === undefined || this.#destroyed || this.#destroying) {
      throw new Error(
        "Cannot subscribe to lifecycle events without an active native surface.",
      );
    }
    if (this.binding.setCommitLifecycleHandler === undefined) {
      return () => {};
    }
    this.#lifecycleListeners.add(listener);
    if (this.#detachNativeLifecycle === undefined) {
      this.#detachNativeLifecycle = subscribeToNativeHostCommitLifecycle(
        this.binding,
        (event) => this.#dispatchLifecycle(event),
      );
    }

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#lifecycleListeners.delete(listener);
      if (this.#lifecycleListeners.size === 0) {
        this.#detachNativeLifecycle?.();
        this.#detachNativeLifecycle = undefined;
      }
    };
  }

  getComponentDescriptor(name: string): NativeComponentDescriptor | undefined {
    return this.#descriptors.get(name);
  }

  #dispatchEvent(event: NativeEvent): void {
    if (event.surface !== this.#surface || this.#destroyed) return;
    for (const listener of [...this.#listeners]) listener(event);
  }

  #dispatchLifecycle(event: HostLifecycleEvent): void {
    if (event.surface !== this.#surface || this.#destroyed) return;
    for (const listener of [...this.#lifecycleListeners]) listener(event);
  }

  #assertSurface(surface: SurfaceId): void {
    if (this.#destroyed || this.#surface === undefined) {
      throw new Error(
        "The native Fabric host does not have an active surface.",
      );
    }
    if (this.#destroying) {
      throw new Error("The native Fabric surface is being destroyed.");
    }
    if (surface !== this.#surface) {
      throw new Error(
        `Surface ${surface} does not belong to this native Fabric host.`,
      );
    }
  }
}

export function createNativeFabricHost(
  options: NativeFabricHostOptions,
): NativeFabricHost {
  return new NativeFabricHost(options);
}
