# `@solid-native/camera`

This package exposes bounded camera permissions, device metadata, session
lifecycle, native-session events, serialized photo capture, and a Solid-owned
live preview. Portable application state sees only validated data and
`CameraSession`; VisionCamera's Nitro HybridObjects remain private to the React
Native adapter and runtime.

The first backend drives VisionCamera 5's imperative Nitro API directly:

```tsx
import {
  CAMERA_PREVIEW_DESCRIPTOR,
  CameraPreview,
  createReactNativeCameraService,
} from "@solid-native/camera/react-native";
import {
  createCameraSessionEvent,
  createOwnedCameraSession,
} from "@solid-native/camera/solid";

const camera = createReactNativeCameraService();
await camera.requestPermission();

const owned = createOwnedCameraSession(camera, {
  position: "back",
  onError: console.error,
});
const session = await owned.ready;
const latestSessionEvent = createCameraSessionEvent(session);

const photo = await session.capturePhoto({
  flashMode: "off",
  enableShutterSound: false,
});
console.log(photo.filePath, photo.width, photo.height);

<CameraPreview session={session} resizeMode="cover" style={{ height: 240 }} />;
```

Add `CAMERA_PREVIEW_DESCRIPTOR` to the descriptors given to
`createNativeFabricHost`. `createOwnedCameraSession` binds asynchronous opening,
lifecycle events, idempotent native stop, and all underlying output disposal to
the current Solid owner. `createCameraSessionEvent` projects a current or
lazily supplied session into an owner-bound accessor. Started, stopped,
interrupted, resumed, and error callbacks enter the causal protocol as stable
`platform.camera.session.*` default-priority events; device identities,
interruption reasons, and native error values remain outside telemetry.
Reactive session replacement detaches the previous subscription before
attaching the next one, root disposal removes the current subscription exactly
once, and setup/removal failures are reported without letting a failing
diagnostic callback break the handoff. `CameraPreview` separately binds the
exact preview output's native-resource retention to its own owner, including
reactive session replacement. A stopped session cannot be mounted again.
Because `CameraService.open()` resolves only after the native session is ready,
each later `CameraSession.subscribe()` receives one next-turn `started` event.
The public boundary deduplicates it against a synchronous or late native
callback, so native readiness cannot be lost between `open()` and subscription
or accidentally merge into the rendering transaction that consumes the
session.

The React Native adapter configures both a preview output and a smallest
device-supported JPEG photo output. The latter gives CameraX a usable readiness
path before the preview surface mounts and backs `CameraSession.capturePhoto()`.
The adapter installs the exact NitroModules `0.36.5` TurboModule through React
Native's narrow registry and resolves only the `CameraFactory` HybridObject. It
accepts both native success encodings (`null` on Android and `undefined` where
the binding omits a value), while rejecting string errors and every other
installer result. It
does not evaluate the `react-native`, VisionCamera, or NitroModules JavaScript
barrels; the production source-map gate rejects those package surfaces.
Captures are serialized, accepted captures finish before session teardown, and
the in-memory Nitro `Photo` is disposed immediately after it writes a temporary
file. The returned frozen value contains only a bounded path, dimensions,
orientation, format, host-clock timestamp, and mirrored state; callers remain
responsible for copying or otherwise managing the temporary file. The adapter
waits for the native started event because lifecycle activation can complete
before hardware reaches its open state.

The preview is a generated VisionCamera `PreviewView` committed directly by
Solid Native Fabric. No VisionCamera hook or React component tree is involved.
The runtime's bounded opaque-resource registry preserves the preview output's
exact JSI identity across RawProps while ordinary application props remain in
the transport-safe host-value domain.

A physical Pixel 9a Release test independently verifies camera acquisition,
the mounted Android `PreviewView`'s positive geometry and `STREAMING` state, a
real JPEG capture with positive dimensions and a temporary path, the capture
result's separate Solid/Fabric commit, then camera release after root disposal.
The signed physical-iPhone Release run also grants permission, selects a back
camera, starts the native session, mounts the generated preview, captures and
commits the real JPEG result, then stops the session. Independent iOS
operating-system assertions for streaming and release, video recording, frame
processors, preview callbacks, gallery persistence, and media library
permissions are not implied by the photo-capture proof.
