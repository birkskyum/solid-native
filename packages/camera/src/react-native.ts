import type {
  CameraPreviewOutput,
  CameraDevice as VisionCameraDevice,
  CameraPosition as VisionCameraPosition,
  PermissionStatus,
} from "react-native-vision-camera";
import * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";
import {
  createNativeComponent,
  createNativeComponentDescriptor,
  type NativeElementProps,
} from "@solid-native/core";
import {
  getNativeHostBinding,
  retainNativeResource,
  type NativeResourceReference,
} from "@solid-native/fabric-host";
import { createMemo, onCleanup } from "solid-js";

import {
  createCameraService,
  cameraAdapterSessionFor,
  type CameraAuthorization,
  type CameraDevice,
  type CameraPhotoCaptureOptions,
  type CameraService,
  type CameraSession,
  type CameraSessionEvent,
} from "./index.js";
import { resolveNitroHybridObject } from "./nitro-adapter.js";

const VERIFIED_NITRO_MODULES_VERSION = "0.36.5";
type VisionCameraAPI =
  (typeof import("react-native-vision-camera"))["VisionCamera"];
let visionCamera: VisionCameraAPI | undefined;

function getVisionCamera(): VisionCameraAPI {
  visionCamera ??= resolveNitroHybridObject<VisionCameraAPI>(
    TurboModuleRegistry,
    globalThis as typeof globalThis & { readonly NitroModulesProxy?: unknown },
    VERIFIED_NITRO_MODULES_VERSION,
    "CameraFactory",
  );
  return visionCamera;
}

export const CAMERA_PREVIEW_RESOURCE_KIND =
  "vision-camera.preview-output" as const;
export const CAMERA_PREVIEW_DESCRIPTOR =
  createNativeComponentDescriptor("PreviewView");

const PREVIEW_OUTPUT_BY_ADAPTER_SESSION = new WeakMap<
  object,
  CameraPreviewOutput
>();

interface NativeCameraPreviewProps extends NativeElementProps {
  readonly previewOutput: NativeResourceReference<
    typeof CAMERA_PREVIEW_RESOURCE_KIND
  >;
  readonly resizeMode?: "cover" | "contain";
  readonly implementationMode?: "performance" | "compatible";
}

export interface CameraPreviewProps extends NativeElementProps {
  readonly session: CameraSession;
  readonly resizeMode?: "cover" | "contain";
  readonly implementationMode?: "performance" | "compatible";
}

const NativeCameraPreview =
  createNativeComponent<NativeCameraPreviewProps>("PreviewView");

/**
 * Mounts VisionCamera's generated Fabric view without a React component tree.
 * The preview output's exact JSI identity follows this Solid component owner.
 */
export function CameraPreview(props: CameraPreviewProps) {
  const resource = createMemo(() => {
    const adapterSession = cameraAdapterSessionFor(props.session);
    const previewOutput =
      adapterSession === undefined
        ? undefined
        : PREVIEW_OUTPUT_BY_ADAPTER_SESSION.get(adapterSession);
    if (previewOutput === undefined) {
      throw new Error(
        "CameraPreview requires a running session created by the React Native camera adapter.",
      );
    }
    const resource = retainNativeResource(
      getNativeHostBinding(),
      CAMERA_PREVIEW_RESOURCE_KIND,
      previewOutput,
    );
    onCleanup(() => resource.release());
    return resource;
  });
  const nativeProps = new Proxy({} as NativeCameraPreviewProps, {
    get(_target, property) {
      if (property === "session") return undefined;
      if (property === "previewOutput") return resource().reference;
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "session") return undefined;
      if (property === "previewOutput") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => property !== "session",
      );
      if (!keys.includes("previewOutput")) keys.push("previewOutput");
      return keys;
    },
  });
  return NativeCameraPreview(nativeProps);
}

export type {
  CameraAuthorization,
  CameraDevice,
  CameraFlashMode,
  CameraPermission,
  CameraPhoto,
  CameraPhotoCaptureOptions,
  CameraPhotoContainerFormat,
  CameraPhotoOrientation,
  CameraService,
  CameraSession,
  CameraSessionEvent,
  CameraTargetPosition,
} from "./index.js";

function authorization(value: PermissionStatus): CameraAuthorization {
  switch (value) {
    case "not-determined":
    case "denied":
    case "authorized":
    case "restricted":
      return value;
  }
}

function position(value: VisionCameraPosition): CameraDevice["position"] {
  switch (value) {
    case "front":
    case "back":
    case "external":
    case "unspecified":
      return value;
  }
}

function cameraDevice(value: VisionCameraDevice): CameraDevice {
  return {
    id: value.id,
    name: value.localizedName,
    position: position(value.position),
    type: value.type,
  };
}

function errorReason(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function disposeHybridObjects(
  objects: readonly ({ dispose(): void } | undefined)[],
): void {
  for (const object of objects) {
    if (object === undefined) continue;
    try {
      object.dispose();
    } catch {
      // Eager disposal is best-effort; one wrapper cannot prevent the others
      // from releasing after the native resource has been disconnected.
    }
  }
}

/**
 * Drives VisionCamera 5's imperative Nitro API directly. React hooks and a
 * React component tree are not involved in permission, device, or session
 * ownership.
 */
export function createReactNativeCameraService(): CameraService {
  const camera = getVisionCamera();
  return createCameraService({
    getPermission() {
      return {
        authorization: authorization(camera.cameraPermissionStatus),
      };
    },
    async requestPermission() {
      if (camera.cameraPermissionStatus === "not-determined") {
        await camera.requestCameraPermission();
      }
      return {
        authorization: authorization(camera.cameraPermissionStatus),
      };
    },
    async listDevices() {
      const factory = await camera.createDeviceFactory();
      try {
        const devices = factory.cameraDevices;
        try {
          return devices.map(cameraDevice);
        } finally {
          disposeHybridObjects(devices);
        }
      } finally {
        disposeHybridObjects([factory]);
      }
    },
    async open(requestedPosition) {
      const factory = await camera.createDeviceFactory();
      let selectedForFailedAcquisition: VisionCameraDevice | undefined;
      let previewForFailedAcquisition: CameraPreviewOutput | undefined;
      const { selectedDevice, photoOutput, previewOutput } = (() => {
        try {
          const selectedDevice = factory.getDefaultCamera(requestedPosition);
          selectedForFailedAcquisition = selectedDevice;
          if (selectedDevice === undefined) {
            throw new Error(
              `No ${requestedPosition} camera is available on this device.`,
            );
          }
          const previewOutput = camera.createPreviewOutput();
          previewForFailedAcquisition = previewOutput;
          const photoResolutions =
            selectedDevice.getSupportedResolutions("photo");
          const targetResolution = photoResolutions.reduce<
            (typeof photoResolutions)[number] | undefined
          >((smallest, candidate) => {
            if (smallest === undefined) return candidate;
            return candidate.width * candidate.height <
              smallest.width * smallest.height
              ? candidate
              : smallest;
          }, undefined);
          if (targetResolution === undefined) {
            throw new Error(
              `The ${requestedPosition} camera has no supported photo resolution.`,
            );
          }
          const photoOutput = camera.createPhotoOutput({
            targetResolution,
            containerFormat: "jpeg",
            quality: 0.8,
            qualityPrioritization: "balanced",
          });
          return { selectedDevice, photoOutput, previewOutput };
        } catch (error) {
          disposeHybridObjects([
            previewForFailedAcquisition,
            selectedForFailedAcquisition,
            factory,
          ]);
          throw error;
        }
      })();
      let nativeSession: Awaited<ReturnType<typeof camera.createCameraSession>>;
      try {
        nativeSession = await camera.createCameraSession(false);
      } catch (error) {
        disposeHybridObjects([
          photoOutput,
          previewOutput,
          selectedDevice,
          factory,
        ]);
        throw error;
      }
      const nativeControllers: Array<{ dispose(): void }> = [];
      const listeners = new Set<(event: CameraSessionEvent) => void>();
      const emit = (event: CameraSessionEvent) => {
        for (const listener of [...listeners]) listener(event);
      };
      let nativeStartSettled = false;
      let resolveNativeStart!: () => void;
      let rejectNativeStart!: (error: Error) => void;
      const nativeStart = new Promise<void>((resolve, reject) => {
        resolveNativeStart = () => {
          if (nativeStartSettled) return;
          nativeStartSettled = true;
          resolve();
        };
        rejectNativeStart = (error) => {
          if (nativeStartSettled) return;
          nativeStartSettled = true;
          reject(error);
        };
      });
      // Configuration can fail before the readiness boundary is awaited.
      // Register a rejection observer immediately to avoid an unhandled native
      // error while still preserving the original promise for the await below.
      void nativeStart.catch(() => undefined);
      const nativeSubscriptions = [
        nativeSession.addOnStartedListener(() => {
          emit({ kind: "started" });
          resolveNativeStart();
        }),
        nativeSession.addOnStoppedListener(() => emit({ kind: "stopped" })),
        nativeSession.addOnErrorListener((error) => {
          const reason = errorReason(error);
          emit({ kind: "error", reason });
          rejectNativeStart(new Error(reason));
        }),
        nativeSession.addOnInterruptionStartedListener((reason) =>
          emit({ kind: "interrupted", reason }),
        ),
        nativeSession.addOnInterruptionEndedListener(() =>
          emit({ kind: "resumed" }),
        ),
      ];
      const removeNativeSubscriptions = () => {
        for (const subscription of nativeSubscriptions) subscription.remove();
      };
      let nativeObjectsDisposed = false;
      const disposeNativeObjects = () => {
        if (nativeObjectsDisposed) return;
        nativeObjectsDisposed = true;
        const objects = [
          ...nativeControllers,
          photoOutput,
          previewOutput,
          selectedDevice,
          nativeSession,
          factory,
        ];
        disposeHybridObjects(objects);
      };

      try {
        const controllers = await nativeSession.configure([
          {
            input: selectedDevice,
            outputs: [
              { output: previewOutput, mirrorMode: "off" },
              { output: photoOutput, mirrorMode: "off" },
            ],
            constraints: [],
          },
        ]);
        nativeControllers.push(...controllers);
        if (controllers.length !== 1) {
          throw new Error(
            "VisionCamera did not return exactly one camera controller.",
          );
        }
        await nativeSession.start();
        if (nativeSession.isRunning) resolveNativeStart();
        const timers = globalThis as typeof globalThis & {
          clearTimeout(handle: unknown): void;
          setTimeout(callback: () => void, milliseconds: number): unknown;
        };
        const timeoutHandle = timers.setTimeout(() => {
          rejectNativeStart(
            new Error("VisionCamera session did not start within 10 seconds."),
          );
        }, 10_000);
        try {
          // On CameraX, start() activates the lifecycle before the hardware has
          // reached OPEN. The native started callback is the readiness boundary.
          await nativeStart;
        } finally {
          timers.clearTimeout(timeoutHandle);
        }
      } catch (error) {
        removeNativeSubscriptions();
        try {
          await nativeSession.stop();
        } catch {
          // Preserve the configuration/start failure.
        }
        disposeNativeObjects();
        throw error;
      }

      let captureTail = Promise.resolve();
      let stopPromise: Promise<void> | undefined;
      const adapterSession = {
        device: cameraDevice(selectedDevice),
        capturePhoto(options: CameraPhotoCaptureOptions) {
          if (stopPromise !== undefined) {
            return Promise.reject(
              new Error("Cannot capture a photo while the camera is stopping."),
            );
          }
          const capture = captureTail.then(async () => {
            const photo = await photoOutput.capturePhoto(
              {
                flashMode: options.flashMode ?? "off",
                enableShutterSound: options.enableShutterSound ?? true,
              },
              {},
            );
            try {
              const filePath = await photo.saveToTemporaryFileAsync();
              return {
                filePath,
                width: photo.width,
                height: photo.height,
                orientation: photo.orientation,
                containerFormat: photo.containerFormat,
                timestamp: photo.timestamp,
                isMirrored: photo.isMirrored,
              };
            } finally {
              photo.dispose();
            }
          });
          captureTail = capture.then(
            () => undefined,
            () => undefined,
          );
          return capture;
        },
        subscribe(listener: (event: CameraSessionEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        stop() {
          stopPromise ??= (async () => {
            let stopFailure: unknown;
            await captureTail;
            try {
              await nativeSession.stop();
            } catch (error) {
              stopFailure = error;
            }
            try {
              await nativeSession.configure([]);
            } catch (error) {
              stopFailure ??= error;
            }
            if (stopFailure !== undefined) throw stopFailure;
          })().finally(() => {
            PREVIEW_OUTPUT_BY_ADAPTER_SESSION.delete(adapterSession);
            removeNativeSubscriptions();
            listeners.clear();
            disposeNativeObjects();
          });
          return stopPromise;
        },
      };
      PREVIEW_OUTPUT_BY_ADAPTER_SESSION.set(adapterSession, previewOutput);
      return adapterSession;
    },
  });
}
