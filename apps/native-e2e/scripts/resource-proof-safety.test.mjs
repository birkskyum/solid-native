import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("keeps the exhaustive hardware proof idle until an explicit press", async () => {
  const [
    application,
    storageAdapter,
    notificationAdapter,
    androidLaunchTest,
    androidTest,
    iosTest,
  ] = await Promise.all([
    readFile(path.join(appDirectory, "index.tsx"), "utf8"),
    readFile(path.join(appDirectory, "adapters/RNAsyncStorage.ts"), "utf8"),
    readFile(path.join(appDirectory, "adapters/NotifeeApiModule.ts"), "utf8"),
    readFile(path.join(appDirectory, "scripts/android-launch-test.sh"), "utf8"),
    readFile(
      path.join(
        appDirectory,
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        appDirectory,
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
      ),
      "utf8",
    ),
  ]);

  const gate = application.indexOf("await resourceProofStarted;");
  const notification = application.indexOf(
    "await notifications.requestPermission()",
  );
  const camera = application.indexOf("await camera.requestPermission()");
  assert.ok(gate >= 0, "The resource proof gate is missing.");
  assert.ok(gate < notification, "Notifications start before the proof gate.");
  assert.ok(gate < camera, "The camera starts before the proof gate.");
  assert.ok(
    application.indexOf("SOLID_NATIVE_QUIESCENT_READY") < gate,
    "The ordinary-launch marker is not published before the resource gate.",
  );
  assert.match(androidLaunchTest, /SOLID_NATIVE_QUIESCENT_READY/u);
  assert.match(
    androidLaunchTest,
    /SOLID_NATIVE_GENERATED_TURBOMODULE_SCHEMA_SUCCEEDED/u,
  );
  assert.doesNotMatch(androidLaunchTest, /grep -Fq 'SOLID_NATIVE_E2E_READY'/u);
  assert.match(
    androidLaunchTest,
    /cleanup\(\)[\s\S]*am force-stop dev\.solidnative\.e2e[\s\S]*trap cleanup EXIT HUP INT TERM/u,
  );
  assert.match(
    androidLaunchTest,
    /android-device-preflight\.sh[\s\S]*solid_native_android_lease_stay_awake[\s\S]*solid_native_android_prepare_device[\s\S]*android-release\.sh/u,
  );
  assert.doesNotMatch(
    application,
    /@solid-native\/notifications\/react-native/u,
  );
  assert.match(
    application,
    /import\(\s*"\.\/adapters\/NotifeeApiModule"\s*\)/u,
  );
  assert.match(notificationAdapter, /createNotifyKit10NotificationService/u);
  assert.match(notificationAdapter, /requireNotifeeApiModuleNativeModule/u);
  assert.match(
    notificationAdapter,
    /react-native\/Libraries\/EventEmitter\/NativeEventEmitter/u,
  );
  assert.match(
    notificationAdapter,
    /from "\.\.\/generated\/SolidNativeBindings";/u,
  );
  assert.doesNotMatch(notificationAdapter, /from "react-native-notify-kit"/u);
  assert.match(
    application,
    /await resourceProofStarted;[\s\S]*await loadNativeNotifications\(\);[\s\S]*await notifications\.requestPermission\(\)/u,
  );
  assert.doesNotMatch(
    application,
    /^import .* from "@solid-native\/camera\/react-native";/mu,
  );
  assert.match(
    application,
    /import\(\s*"@solid-native\/camera\/react-native"\s*\)/u,
  );
  assert.match(
    application,
    /await resourceProofStarted;[\s\S]*await loadNativeCamera\(\);[\s\S]*await camera\.requestPermission\(\)/u,
  );
  assert.match(
    application,
    /const \[cameraPreviewComponent, setCameraPreviewComponent\] =\s*createSignal<CameraPreviewComponent>\(\)/u,
  );
  assert.match(
    application,
    /setCameraPreviewComponent\(\(\) => CameraPreview\)/u,
  );
  assert.match(
    application,
    /const renderCameraPreview = \(\) => \{[\s\S]*cameraPreviewComponent\(\)[\s\S]*cameraPreviewSession\(\)[\s\S]*createComponent\(CameraPreview/u,
  );
  assert.match(
    application,
    /const coldRootLifecycleStart = screenLifecycleEvents\.length;[\s\S]*waitForScreenLifecycle\([\s\S]*coldRootLifecycleStart,[\s\S]*"\/",[\s\S]*"focus"[\s\S]*coldRootFocusUpdate[\s\S]*proofCommitOffset\+\+/u,
  );
  assert.doesNotMatch(application, /@solid-native\/storage\/react-native/u);
  assert.match(application, /import\(\s*"\.\/adapters\/RNAsyncStorage"\s*\)/u);
  assert.match(storageAdapter, /from "\.\.\/generated\/SolidNativeBindings";/u);
  assert.match(
    storageAdapter,
    /createAsyncStorage3KeyValueStorage\(native, options\)/u,
  );
  assert.doesNotMatch(
    storageAdapter,
    /@react-native-async-storage\/async-storage/u,
  );
  assert.match(
    application,
    /await resourceProofStarted;[\s\S]*proveGeneratedStorageTurboModuleRuntime\(\);[\s\S]*await loadNativeStorage\(\);[\s\S]*await proveStorageTurboModule\(storage\)/u,
  );
  assert.ok(
    application.indexOf(
      "resolveRNAsyncStorageNativeModule(TurboModuleRegistry)",
    ) < gate,
    "The generated resolver declaration is missing before the resource gate.",
  );
  assert.ok(
    application.indexOf("proveGeneratedStorageTurboModuleRuntime();") > gate,
    "The generated AsyncStorage resolver runs before the resource gate.",
  );
  assert.match(
    application,
    /<ActivityIndicator[\s\S]*?animating=\{false\}[\s\S]*?<\/Pressable>/u,
  );
  assert.match(androidTest, /tapCenter\(resourceProofStart\)/u);
  assert.match(iosTest, /resourceProofStart\.tap\(\)/u);
  assert.match(application, /RESOURCE_PROOF_WATCHDOG_MS = 3 \* 60_000/u);
  assert.match(
    application,
    /if \(!appStateProofArmed\)[\s\S]*didLeaveForeground = false[\s\S]*appStateProofArmed = true;[\s\S]*SOLID_NATIVE_E2E_READY/u,
  );
  const armed = application.indexOf("\n  armResourceProofWatchdog();");
  assert.ok(armed > gate, "The proof does not arm its resource watchdog.");
  assert.ok(
    armed < notification,
    "The resource watchdog starts after notification acquisition.",
  );
  assert.match(
    application,
    /navigationPersistence\?\.dispose\(\);[\s\S]*Promise\.allSettled\(\[[\s\S]*nativeNotifications\?\.cancel[\s\S]*ownedCameraSession\?\.stop\(\)[\s\S]*application\?\.dispose\(\)/u,
  );
  assert.ok(
    application.indexOf("disarmResourceProofWatchdog();") <
      application.indexOf(
        'console.log("SOLID_NATIVE_CAMERA_SESSION_STOP_SUCCEEDED")',
      ),
    "Successful teardown does not disarm the watchdog.",
  );
});
