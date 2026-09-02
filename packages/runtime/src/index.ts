import {
  assertCompatibleHost,
  type NativeComponentDescriptor,
  type NativeHost,
  type HostRequirements,
} from "@solid-native/host-contract";
import {
  mount,
  mountAsync,
  type NativeApplication,
  type NativeRootOptions,
} from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  installReactNativeFatalErrorHandler,
  reportNativeFatalError,
  retainNativeResource,
  supportsNativeFatalErrorReporting,
  waitForNativeSurface,
  type NativeFabricBinding,
  type ReactNativeFatalErrorHandlerOptions,
  type RetainedNativeResource,
} from "@solid-native/fabric-host";
import { onCleanup } from "solid-js";

export * from "@solid-native/fabric-host";
export {
  IncompatibleHostError,
  assertCompatibleHost,
  inspectHost,
  type HostCapabilityName,
  type HostRequirements,
  type HostValidationReport,
  type NativeHostFingerprint,
  type RuntimeFingerprint,
} from "@solid-native/host-contract";
export {
  NATIVE_PLATFORM_MAX_URL_LENGTH,
  createNativePlatformServices,
  type NativeAppState,
  type NativeColorScheme,
  type NativeColorSchemeOverride,
  type NativeKeyboardMetrics,
  type NativeKeyboardState,
  type NativePlatformFingerprint,
  type NativePlatformServices,
  type NativePlatformServicesAdapter,
  type NativeStatusBarAnimation,
  type NativeStatusBarConfiguration,
  type NativeStatusBarStackEntry,
  type NativeStatusBarStyle,
  type NativeSubscription,
  type NativeURLEvent,
  type NativeWindowMetrics,
} from "./platform-services.js";

export interface StartApplicationOptions extends NativeRootOptions {
  readonly requirements?: HostRequirements;
}

export interface StartNativeApplicationOptions extends StartApplicationOptions {
  readonly binding?: NativeFabricBinding;
  readonly descriptors: readonly NativeComponentDescriptor[];
  /**
   * Owns React Native's fatal Hermes bridge for the exact application lifetime.
   * Defaults to the global ErrorUtils bridge when native fatal reporting exists.
   * Set false only when a custom shell owns that global slot.
   */
  readonly fatalErrorHandler?:
    false | Omit<ReactNativeFatalErrorHandlerOptions, "binding">;
  readonly surfaceReadyTimeoutMs?: number;
  readonly surfaceReadyPollIntervalMs?: number;
}

/** Retains an opaque Fabric prop resource until the current Solid owner is disposed. */
export function retainOwnedNativeResource<Kind extends string>(
  binding: NativeFabricBinding,
  kind: Kind,
  value: object,
): RetainedNativeResource<Kind> {
  const resource = retainNativeResource(binding, kind, value);
  onCleanup(() => resource.release());
  return resource;
}

export function startApplication(
  code: () => unknown,
  host: NativeHost,
  options: StartApplicationOptions,
): NativeApplication {
  assertApplicationHost(host, options);
  return mount(code, host, options);
}

/**
 * Starts a backend-neutral application and waits for surface rollback before
 * reporting an initial Solid render failure.
 */
export async function startApplicationAsync(
  code: () => unknown,
  host: NativeHost,
  options: StartApplicationOptions,
): Promise<NativeApplication> {
  assertApplicationHost(host, options);
  return mountAsync(code, host, options);
}

function assertApplicationHost(
  host: NativeHost,
  options: StartApplicationOptions,
): void {
  const rootComponent = options.rootComponent ?? "RootView";
  assertCompatibleHost(host, {
    ...options.requirements,
    components: [rootComponent, ...(options.requirements?.components ?? [])],
  });
}

/**
 * Performs the complete JavaScript side of native startup: wait for ownership
 * transfer, create the version-pinned Fabric adapter, validate requirements,
 * and mount the Solid root.
 */
export async function startNativeApplication(
  code: () => unknown,
  options: StartNativeApplicationOptions,
): Promise<NativeApplication> {
  const {
    binding = getNativeHostBinding(),
    descriptors,
    fatalErrorHandler: fatalErrorHandlerOptions,
    surfaceReadyTimeoutMs,
    surfaceReadyPollIntervalMs,
    ...applicationOptions
  } = options;
  const supportsFatalErrorReporting =
    supportsNativeFatalErrorReporting(binding);
  const fatalErrorHandler =
    supportsFatalErrorReporting && fatalErrorHandlerOptions !== false
      ? installReactNativeFatalErrorHandler({
          binding,
          ...(fatalErrorHandlerOptions ?? {}),
        })
      : undefined;
  try {
    await waitForNativeSurface({
      binding,
      ...(surfaceReadyTimeoutMs === undefined
        ? {}
        : { timeoutMs: surfaceReadyTimeoutMs }),
      ...(surfaceReadyPollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: surfaceReadyPollIntervalMs }),
    });
    const host = createNativeFabricHost({ binding, descriptors });
    const applicationCommitError = applicationOptions.onCommitError;
    const nativeApplicationOptions = {
      ...applicationOptions,
      ...(supportsFatalErrorReporting
        ? {
            onCommitError(error: unknown) {
              try {
                reportNativeFatalError(binding, error);
              } finally {
                applicationCommitError?.(error);
              }
            },
          }
        : {}),
    } satisfies StartApplicationOptions;
    assertApplicationHost(host, nativeApplicationOptions);
    const application = await mountAsync(code, host, nativeApplicationOptions);
    if (fatalErrorHandler === undefined) return application;
    let disposal: Promise<void> | undefined;
    return {
      root: application.root,
      dispose(): Promise<void> {
        disposal ??= application
          .dispose()
          .finally(() => fatalErrorHandler.remove());
        return disposal;
      },
    };
  } catch (error) {
    fatalErrorHandler?.remove();
    throw error;
  }
}
