import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
  VERIFIED_HERMES_BYTECODE_VERSION,
  VERIFIED_HERMES_COMPILER_VERSION,
  VERIFIED_REACT_NATIVE_PACKAGE_VERSION,
  VERIFIED_REACT_NATIVE_RUNTIME_VERSION,
} from "@solid-native/cli";
import { REACT_NATIVE_0_87_BACKEND } from "@solid-native/fabric-host";

const require = createRequire(new URL("../package.json", import.meta.url));

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("keeps package, runtime, Hermes, and native host identities aligned", () => {
  const release = REACT_NATIVE_0_87_BACKEND;
  const applicationManifest = JSON.parse(read("../package.json"));
  const nativeHeader = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricApi.h",
  );
  const iosBinding = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
  );
  const androidBinding = read(
    "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
  );
  const podspec = read(
    "../../../packages/fabric-host/native/SolidNativeFabric.podspec",
  );
  const boundary = JSON.parse(
    read("../../../packages/fabric-host/native/react-native-boundary.json"),
  );

  assert.equal(VERIFIED_REACT_NATIVE_PACKAGE_VERSION, release.packageVersion);
  assert.equal(VERIFIED_REACT_NATIVE_RUNTIME_VERSION, release.backendVersion);
  assert.equal(VERIFIED_HERMES_COMPILER_VERSION, release.engineVersion);
  assert.equal(VERIFIED_HERMES_BYTECODE_VERSION, release.engineBytecodeVersion);
  assert.equal(
    applicationManifest.dependencies["react-native"],
    release.packageVersion,
  );
  assert.equal(
    applicationManifest.devDependencies["hermes-compiler"],
    release.engineVersion,
  );
  assert.equal(boundary.reactNativeVersion, release.packageVersion);
  assert.match(
    nativeHeader,
    /ReactNativeVersion\s*=\s*\n?\s*SOLID_NATIVE_REACT_NATIVE_RUNTIME_VERSION/u,
  );
  assert.match(nativeHeader, /#include <cxxreact\/ReactNativeVersion\.h>/u);
  for (const part of ["MAJOR", "MINOR", "PATCH"]) {
    assert.match(
      nativeHeader,
      new RegExp(
        `REACT_NATIVE_VERSION_${part} != SOLID_NATIVE_REACT_NATIVE_VERSION_${part}`,
        "u",
      ),
    );
  }
  for (const binding of [iosBinding, androidBinding]) {
    assert.match(
      binding,
      /setProperty\(runtime, "backendVersion", ReactNativeVersion\)/u,
    );
    assert.doesNotMatch(
      binding,
      /setProperty\(runtime, "backendVersion", "[^"]+"\)/u,
    );
  }
  const podVersions = [
    ...podspec.matchAll(/spec\.dependency "React-[^"]+", "= ([^"]+)"/gu),
  ].map((match) => match[1]);
  assert.ok(podVersions.length > 0);
  assert.deepEqual([...new Set(podVersions)], ["#{react_native_release}"]);
  assert.match(
    podspec,
    /react-native-boundary\.json[\s\S]*GCC_PREPROCESSOR_DEFINITIONS/u,
  );
});

test("resolves the iOS podspec through the installed Fabric Host package", () => {
  const podfile = read("../ios/Podfile");
  const fabricHostManifest = JSON.parse(
    read("../../../packages/fabric-host/package.json"),
  );
  const resolvedPodspec = realpathSync(
    require.resolve("@solid-native/fabric-host/ios-podspec"),
  );
  const sourcePodspec = realpathSync(
    new URL(
      "../../../packages/fabric-host/native/SolidNativeFabric.podspec",
      import.meta.url,
    ),
  );

  assert.equal(
    fabricHostManifest.exports["./ios-podspec"],
    "./native/SolidNativeFabric.podspec",
  );
  assert.equal(resolvedPodspec, sourcePodspec);
  assert.match(
    podfile,
    /require\.resolve\([\s\S]*"@solid-native\/fabric-host\/ios-podspec"/,
  );
  assert.match(podfile, /--preserve-symlinks/);
  assert.match(podfile, /relative_path_from\(Pathname\.new\(__dir__\)\)/);
  assert.match(
    podfile,
    /pod 'SolidNativeFabric', :path => solid_native_fabric_host_native_path/,
  );
  assert.doesNotMatch(podfile, /packages\/(?:fabric-host|runtime)\/native/);
});

test("boots iOS through the package-owned production application", () => {
  const appDelegate = read("../ios/SolidNativeE2E/AppDelegate.swift");
  const podspec = read(
    "../../../packages/fabric-host/native/SolidNativeFabric.podspec",
  );
  const implementation = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricApplication.mm",
  );
  const binding = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
  );
  const surface = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricSurface.mm",
  );
  const debugRequest = read(
    "../../../packages/fabric-host/native/apple/SolidNativeDebugRequest.mm",
  );
  const startupFailureHeader = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeStartupFailureView.h",
  );
  const startupFailureView = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeStartupFailureView.mm",
  );

  assert.match(appDelegate, /SolidNativeFabricApplication\.start\(/u);
  assert.match(
    appDelegate,
    /SolidNativeDebugRequest\.handle\(url: requestURL\)[\s\S]*SolidNativeDebugRequest\.handle\(url: url\)/u,
  );
  assert.doesNotMatch(appDelegate, /SolidNativeFabricSmokeApplication/u);
  assert.match(
    podspec,
    /public_header_files = \[[\s\S]*fabric\/SolidNativeDebugRequest\.h[\s\S]*SolidNativeFabricApplication\.h[\s\S]*SolidNativeStartupFailureView\.h/u,
  );
  assert.match(
    podspec,
    /private_header_files = \[[\s\S]*SolidNativeFabricSurface\.h/u,
  );
  assert.doesNotMatch(
    podspec,
    /source_files = \[[\s\S]*SolidNativeFabricSmokeApplication/u,
  );
  assert.doesNotMatch(podspec, /fabric\/\*\*/u);
  assert.match(
    podspec,
    /source_files = \[[\s\S]*SolidNativeFabricSurface\.mm/u,
  );
  assert.doesNotMatch(implementation, /SolidNativeFabricSmokeSurface/u);
  assert.match(podspec, /spec\.dependency "ReactCodegen"/u);
  assert.match(
    debugRequest,
    /SOLID_NATIVE_CAUSAL_DEBUG_ACTIVE[\s\S]*solid-native-debug[\s\S]*SolidNativeDebugOperationDiagnosticsBegin[\s\S]*SolidNativeDebugPendingRequestOperations[\s\S]*SolidNativeDebugPendingRequestSessions[\s\S]*emitOnSnapshotRequest[\s\S]*NSDataWritingAtomic[\s\S]*NativeSolidNativeDebugSpecJSI/u,
  );
  assert.match(
    debugRequest,
    /requests = \[SolidNativeDebugPendingRequests\(\)\.array copy\];[\s\S]*removeAllObjects/u,
  );
  assert.doesNotMatch(debugRequest, /RCTEventEmitter/u);
  assert.match(startupFailureHeader, /NS_SWIFT_NAME\(show\(in:error:\)\)/u);
  assert.match(
    startupFailureView,
    /#if DEBUG[\s\S]*boundedDiagnostic\(error\)[\s\S]*#endif/u,
  );
  assert.match(
    startupFailureView,
    /MaxDiagnosticLength[\s\S]*isAccessibilityElement = YES[\s\S]*UIAccessibilityPostNotification/u,
  );
  assert.doesNotMatch(
    startupFailureView,
    /React|SolidNativeFabricApplication/u,
  );
  assert.match(
    implementation,
    /prepareEmptySurfaceForJSIOwnershipWithCompletion/u,
  );
  assert.match(
    implementation,
    /setFatalErrorHandler:[\s\S]*handleFatalErrorWithName:[\s\S]*reportStatus:@"runtime-failed"[\s\S]*\[self stop\][\s\S]*SolidNativeStartupFailureView/u,
  );
  assert.doesNotMatch(implementation, /mountText:|rollback-succeeded/u);
  assert.match(
    binding,
    /- \(void\)invalidate \{[\s\S]*cancelAllUIWorklets\(\)/u,
  );
  assert.match(
    binding,
    /deactivateIOSUIWorklet\([\s\S]*frameObserver = state->frameObserver;[\s\S]*invalidateIOSUIWorkletFrameObserver\(frameObserver\)/u,
  );
  assert.match(
    binding,
    /if \(!scheduleNextFrame\) frameWorklet->frameObserver = nil;/u,
  );
  assert.match(
    binding,
    /uiWorkletActivityCounts\(\)[\s\S]*"pendingUIWorkletFrameCount"/u,
  );
  assert.match(
    binding,
    /"reportFatalError"[\s\S]*MaximumFatalErrorNameBytes[\s\S]*reportFatalErrorWithName/u,
  );
  const androidBinding = read(
    "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
  );
  assert.match(
    androidBinding,
    /uiWorkletActivityCounts\(\)[\s\S]*"pendingUIWorkletFrameCount"/u,
  );
  assert.match(
    binding,
    /setRuntimeRetirementHandler\([\s\S]*retireRuntimeGeneration:runtimeGeneration/u,
  );
  assert.match(
    binding,
    /- \(void\)retireRuntimeGeneration:\(uint64_t\)generation[\s\S]*removeSolidNativeEventListener[\s\S]*resetForJSRuntimeReload/u,
  );
  assert.match(
    surface,
    /- \(void\)resetForJSRuntimeReload \{[\s\S]*_coordinator->reset\(\)/u,
  );
});

test("routes View layout into Solid-owned keyboard avoidance", () => {
  const core = read("../../../packages/core/src/index.ts");
  const coordinator = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
  );
  const iosBinding = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
  );
  const androidBinding = read(
    "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
  );

  assert.match(
    core,
    /calculateKeyboardAvoidanceInset\([\s\S]*horizontalIntersection <= 0[\s\S]*Math\.min\(frame\.height, intersection\)/u,
  );
  assert.match(
    core,
    /createKeyboardAvoidingView\([\s\S]*keyboard\.avoidance\.measurement[\s\S]*Promise\.resolve\(\)\.then\(startMeasurement\)[\s\S]*height: avoidanceInset\(\)/u,
  );
  assert.match(
    core,
    /calculateFocusedFieldScrollOffset\([\s\S]*keyboardCoversViewport[\s\S]*fieldBottomWithClearance[\s\S]*createKeyboardAwareScrollView\([\s\S]*keyboard\.focus\.visibility[\s\S]*dispatchCommand\("scrollTo"/u,
  );
  assert.match(
    core,
    /handleFocus[\s\S]*keyboardAwareScrollController\([\s\S]*\.focus\(\s*event\.target,?\s*\)[\s\S]*handleBlur[\s\S]*\.blur\(event\.target\)/u,
  );
  assert.match(
    core,
    /createNativeComponentDescriptor\("View", \{[\s\S]*directEvents: \["layout", \.\.\.ACCESSIBILITY_DIRECT_EVENTS\]/u,
  );
  assert.match(
    coordinator,
    /node\.component == "View"[\s\S]*event == "layout"[\s\S]*result\["onLayout"\] = true/u,
  );
  assert.match(
    coordinator,
    /node\.component == "View" \|\| node\.component == "RNCSafeAreaView"\)[\s\S]*return event == "layout"/u,
  );
  assert.match(
    iosBinding,
    /name == "contentSizeChange" \|\| name == "insetsChange" \|\|[\s\S]*name == "layout" \|\| name == "selectionChange"/u,
  );
  assert.match(
    androidBinding,
    /name == "contentSizeChange" \|\| name == "insetsChange" \|\|[\s\S]*name == "layout" \|\| name == "selectionChange"/u,
  );
});

test("routes native Pressable movement into Solid-owned retention state", () => {
  const core = read("../../../packages/core/src/index.ts");
  const coordinator = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
  );
  const iosBinding = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
  );
  const androidBinding = read(
    "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
  );

  assert.match(
    core,
    /pressRetentionOffset[\s\S]*handlePressMove[\s\S]*isInsideRetention[\s\S]*deactivatePress/u,
  );
  assert.match(
    core,
    /"pressCancel"[\s\S]*"pressMove"[\s\S]*directEvents: \[[\s\S]*"layout"/u,
  );
  assert.match(
    coordinator,
    /event == "pressMove"[\s\S]*onPointerMove[\s\S]*onTouchMove[\s\S]*event == "pressCancel"[\s\S]*onTouchCancel[\s\S]*onPointerCancel/u,
  );
  for (const binding of [iosBinding, androidBinding]) {
    assert.match(
      binding,
      /touchMove" \|\| name == "pointerMove"[\s\S]*"pressMove"[\s\S]*touchCancel" \|\| name == "pointerCancel"[\s\S]*"pressCancel"/u,
    );
  }
});

test("routes Solid-owned Android ripple feedback through generic Fabric commands", () => {
  const core = read("../../../packages/core/src/index.ts");
  const transaction = read(
    "../../../packages/fabric-host/src/native-transaction.ts",
  );
  const coordinator = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
  );

  assert.match(
    core,
    /android_ripple[\s\S]*nativeBackgroundAndroid[\s\S]*nativeForegroundAndroid[\s\S]*hotspotUpdate[\s\S]*setPressed/u,
  );
  assert.match(
    core,
    /commands: \{[\s\S]*hotspotUpdate: \["x", "y"\][\s\S]*setPressed: \["pressed"\]/u,
  );
  assert.match(
    transaction,
    /nativeBackgroundAndroid[\s\S]*nativeForegroundAndroid/u,
  );
  assert.match(
    coordinator,
    /node\.component == "RootView" \|\| node\.component == "View" \|\|[\s\S]*node\.component == "Pressable"[\s\S]*return "RCTView"/u,
  );
});

test("routes the native safe-area provider without a React wrapper", () => {
  const manifest = JSON.parse(read("../package.json"));
  const core = read("../../../packages/core/src/index.ts");
  const coordinator = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
  );

  assert.equal(
    manifest.dependencies["react-native-safe-area-context"],
    "5.8.1",
  );
  assert.match(
    core,
    /createElement\("RNCSafeAreaProvider"\)[\s\S]*native safe-area event[\s\S]*SafeAreaMetricsProvider/u,
  );
  assert.match(
    core,
    /createElement\("RNCSafeAreaView"\)[\s\S]*normalizeSafeAreaEdges/u,
  );
  assert.match(
    core,
    /createNativeComponentDescriptor\("RNCSafeAreaProvider", \{[\s\S]*"insetsChange"/u,
  );
  assert.match(
    coordinator,
    /node\.component == "RNCSafeAreaProvider"[\s\S]*event == "insetsChange"[\s\S]*result\["onInsetsChange"\] = true/u,
  );
  assert.match(
    coordinator,
    /node\.component == "RNCSafeAreaProvider"[\s\S]*return event == "insetsChange" \|\| event == "layout"/u,
  );
});

test("projects React-free native appearance into Solid ownership", () => {
  const runtime = read(
    "../../../packages/runtime/src/react-native-platform-services.ts",
  );
  const core = read("../../../packages/core/src/index.ts");

  assert.match(
    runtime,
    /Libraries\/Utilities\/Appearance[\s\S]*getColorScheme: \(\) => Appearance\.getColorScheme\(\)[\s\S]*setColorSchemeOverride:[\s\S]*Appearance\.setColorScheme\(scheme === "system" \? "auto" : scheme\)[\s\S]*subscribeColorScheme:/u,
  );
  assert.doesNotMatch(runtime, /useColorScheme|from ["']react["']/u);
  assert.match(
    core,
    /createColorScheme\([\s\S]*createCausalPlatformEventHandler\("platform\.appearance\.change", setScheme\)[\s\S]*onCleanup\(\(\) => subscription\.remove\(\)\)/u,
  );
});

test("owns cross-platform memory warnings without the React Native AppState facade", () => {
  const runtime = read(
    "../../../packages/runtime/src/react-native-platform-services.ts",
  );
  const core = read("../../../packages/core/src/index.ts");
  const platformModule = read(
    "../../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativePlatformModule.kt",
  );
  const mainApplication = read(
    "../android/app/src/main/java/dev/solidnative/e2e/MainApplication.kt",
  );

  assert.match(
    runtime,
    /getEnforcing<SolidNativePlatformAndroidModule>\([\s\S]*"SolidNativePlatformAndroid"[\s\S]*solidNativePlatform === undefined[\s\S]*appStateEmitter\.addListener\("memoryWarning", listener\)[\s\S]*solidNativePlatform\.onMemoryWarning\(listener\)/u,
  );
  assert.doesNotMatch(runtime, /Libraries\/AppState\/AppState/u);
  assert.match(
    platformModule,
    /NativeSolidNativePlatformAndroidSpec\(context\)[\s\S]*emitOnMemoryWarning\(event\)/u,
  );
  assert.match(
    mainApplication,
    /onTrimMemory\(level: Int\)[\s\S]*SolidNativeMemoryWarning\.handleTrimMemory\(level\)[\s\S]*onLowMemory\(\)[\s\S]*SolidNativeMemoryWarning\.handleLowMemory\(\)/u,
  );
  assert.match(
    core,
    /createMemoryWarningCount\([\s\S]*createCausalPlatformEventHandler\("platform\.memory-warning"[\s\S]*onCleanup\(\(\) => subscription\.remove\(\)\)/u,
  );
});

test("controls the native status bar through Solid ownership", () => {
  const application = read("../index.tsx");
  const infoPlist = read("../ios/SolidNativeE2E/Info.plist");
  const runtime = read(
    "../../../packages/runtime/src/react-native-platform-services.ts",
  );
  const core = read("../../../packages/core/src/index.ts");

  assert.match(
    runtime,
    /getEnforcing<StatusBarManagerModule>\("StatusBarManager"\)/u,
  );
  assert.match(
    runtime,
    /setStatusBarHidden:[\s\S]*statusBar\.setHidden[\s\S]*setStatusBarStyle:[\s\S]*statusBar\.setStyle/u,
  );
  assert.doesNotMatch(
    runtime,
    /Libraries\/Components\/StatusBar\/StatusBar|from ["']react["']/u,
  );
  assert.match(
    core,
    /createStatusBar\([\s\S]*pushStatusBarEntry\(configuration\)[\s\S]*entry\?\.replace\(configuration\)[\s\S]*activeEntry\?\.remove\(\)/u,
  );
  assert.match(
    application,
    /createComponent\(StatusBar, \{[\s\S]*source: NativePlatform[\s\S]*barStyle: "auto"[\s\S]*hidden: false/u,
  );
  assert.match(
    infoPlist,
    /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<false\/>/u,
  );
});

test("presents native alerts through pinned TurboModules without Alert.js", () => {
  const registry = read("../../../packages/dialogs/src/react-native.ts");
  const adapter = read("../../../packages/dialogs/src/react-native-adapter.ts");
  const solid = read("../../../packages/dialogs/src/solid.ts");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*DialogManagerAndroid[\s\S]*AlertManager/u,
  );
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/Alert\/Alert|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(
    registry,
    /assertVerifiedReactNativePlatform[\s\S]*createAndroidAlertAdapter[\s\S]*createIOSAlertAdapter/u,
  );
  assert.match(
    adapter,
    /showAlert\([\s\S]*alertWithArgs\([\s\S]*rawButtonKey[\s\S]*iosButtonIndex\(rawButtonKey, request\.buttons\.length\)/u,
  );
  assert.match(
    solid,
    /platform\.alert\.button[\s\S]*platform\.alert\.dismissed[\s\S]*onCleanup/u,
  );
});

test("presents system sharing through pinned TurboModules without Share.js", () => {
  const registry = read("../../../packages/sharing/src/react-native.ts");
  const adapter = read("../../../packages/sharing/src/react-native-adapter.ts");
  const solid = read("../../../packages/sharing/src/solid.ts");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*ShareModule[\s\S]*ActionSheetManager/u,
  );
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/Share\/Share|Libraries\/ActionSheetIOS\/ActionSheetIOS|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(
    registry,
    /assertVerifiedReactNativePlatform[\s\S]*createAndroidShareAdapter[\s\S]*createIOSShareAdapter/u,
  );
  assert.match(
    adapter,
    /module\.share\([\s\S]*undefined,[\s\S]*showShareActionSheetWithOptions\([\s\S]*activityType/u,
  );
  assert.match(
    solid,
    /platform\.share\.presented[\s\S]*platform\.share\.completed[\s\S]*platform\.share\.dismissed[\s\S]*onCleanup/u,
  );
});

test("owns vibration through its pinned TurboModule without Vibration.js", () => {
  const registry = read("../../../packages/vibration/src/react-native.ts");
  const adapter = read(
    "../../../packages/vibration/src/react-native-adapter.ts",
  );
  const solid = read("../../../packages/vibration/src/solid.ts");
  const manifest = read("../android/app/src/main/AndroidManifest.xml");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*get<ReactNativeVibrationModule>\("Vibration"\)/u,
  );
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/Vibration\/(?:Native)?Vibration|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(
    registry,
    /assertVerifiedReactNativePlatform[\s\S]*createAndroidVibrationAdapter[\s\S]*createIOSVibrationAdapter/u,
  );
  assert.match(
    adapter,
    /vibrateByPattern\(waveform[\s\S]*schedulePattern[\s\S]*cancelScheduled/u,
  );
  assert.match(solid, /onCleanup[\s\S]*current\?\.cancel\(\)/u);
  assert.match(manifest, /android\.permission\.VIBRATE/u);
});

test("owns privacy-safe clipboard reads without Clipboard.js", () => {
  const registry = read("../../../packages/clipboard/src/react-native.ts");
  const adapter = read(
    "../../../packages/clipboard/src/react-native-adapter.ts",
  );
  const solid = read("../../../packages/clipboard/src/solid.ts");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*get<ReactNativeClipboardModule>\("Clipboard"\)/u,
  );
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/Components\/Clipboard|specs_DEPRECATED\/modules\/NativeClipboard|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(
    registry,
    /assertVerifiedReactNativePlatform[\s\S]*createReactNativeClipboardAdapter/u,
  );
  assert.match(
    adapter,
    /createClipboardService\([\s\S]*value\.getString\(\)[\s\S]*value\.setString\(text\)/u,
  );
  assert.match(
    solid,
    /platform\.clipboard\.read[\s\S]*priority: "default"[\s\S]*onCleanup/u,
  );
  assert.doesNotMatch(solid, /attributes[\s\S]*(?:text|content)/u);
});

test("reads startup localization without I18nManager.js mutation APIs", () => {
  const registry = read("../../../packages/localization/src/react-native.ts");
  const adapter = read(
    "../../../packages/localization/src/react-native-adapter.ts",
  );
  const contract = read("../../../packages/localization/src/index.ts");
  const manifest = read("../android/app/src/main/AndroidManifest.xml");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*get<ReactNativeI18nManagerModule>\("I18nManager"\)/u,
  );
  assert.match(registry, /assertVerifiedReactNativePlatform/u);
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/ReactNative\/(?:I18nManager|NativeI18nManager)|specs_DEPRECATED\/modules\/NativeI18nManager|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(adapter, /Intl\.DateTimeFormat/u);
  assert.match(adapter, /constants\.localeIdentifier/u);
  assert.match(adapter, /readLocalizationSnapshot/u);
  assert.doesNotMatch(
    `${registry}\n${adapter}\n${contract}`,
    /allowRTL|forceRTL|swapLeftAndRightInRTL\s*\(/u,
  );
  assert.match(manifest, /android:supportsRtl="true"/u);
});

test("owns image loading through the direct pinned ImageLoader ABI", () => {
  const registry = read("../../../packages/images/src/react-native.ts");
  const adapter = read("../../../packages/images/src/react-native-adapter.ts");
  const contract = read("../../../packages/images/src/index.ts");
  const solid = read("../../../packages/images/src/solid.ts");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*get<AndroidImageLoaderModule>\("ImageLoader"\)[\s\S]*get<IOSImageLoaderModule>\("ImageLoader"\)/u,
  );
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/Image\/(?:Image\.(?:android|ios)|NativeImageLoader)|specs_DEPRECATED\/modules\/NativeImageLoader|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(
    registry,
    /assertVerifiedReactNativePlatform[\s\S]*createAndroidImageAdapter[\s\S]*createIOSImageAdapter/u,
  );
  assert.match(
    adapter,
    /module\.prefetchImage\(uri, requestId\)[\s\S]*normalizedIOSDimensions[\s\S]*module\.prefetchImage\(uri\)/u,
  );
  assert.match(
    contract,
    /IMAGE_MAX_CACHE_QUERY_URIS[\s\S]*allocateRequestId[\s\S]*cancelPrefetch\(requestId\)[\s\S]*unrequested URI/u,
  );
  assert.match(
    solid,
    /platform\.image\.dimensions[\s\S]*platform\.image\.prefetch[\s\S]*platform\.image\.cache-query[\s\S]*onCleanup/u,
  );
  assert.doesNotMatch(solid, /attributes[\s\S]*(?:uri|headers)/u);
});

test("streams text through the direct pinned Networking ABI", () => {
  const registry = read("../../../packages/networking/src/react-native.ts");
  const adapter = read(
    "../../../packages/networking/src/react-native-adapter.ts",
  );
  const contract = read("../../../packages/networking/src/index.ts");
  const serverEvents = read(
    "../../../packages/networking/src/server-events.ts",
  );
  const solid = read("../../../packages/networking/src/solid.ts");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*get<AndroidNetworkingModule>\("Networking"\)[\s\S]*get<IOSNetworkingModule>\("Networking"\)/u,
  );
  assert.match(registry, /Libraries\/EventEmitter\/RCTDeviceEventEmitter/u);
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/Network\/(?:fetch|XMLHttpRequest|RCTNetworking|NativeNetworking)|specs_DEPRECATED\/modules\/NativeNetworking|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(
    registry,
    /assertVerifiedReactNativePlatform[\s\S]*createAndroidNetworkingAdapter[\s\S]*createIOSNetworkingAdapter/u,
  );
  assert.match(
    adapter,
    /module\.sendRequest\([\s\S]*request\.method[\s\S]*Object\.entries\(request\.headers\)[\s\S]*module\.sendRequest\([\s\S]*incrementalUpdates: true/u,
  );
  assert.match(
    contract,
    /NETWORK_MAX_RESPONSE_CHARACTERS[\s\S]*progress must be monotonic[\s\S]*completed without response metadata/u,
  );
  assert.match(
    solid,
    /platform\.network\.response[\s\S]*platform\.network\.chunk[\s\S]*platform\.network\.complete[\s\S]*platform\.network\.error[\s\S]*onCleanup/u,
  );
  assert.doesNotMatch(solid, /attributes[\s\S]*(?:url|headers|body|text)/u);
  assert.match(
    serverEvents,
    /createServerEventDecoder[\s\S]*maxLineCharacters[\s\S]*maxDataCharacters[\s\S]*maxEvents[\s\S]*requestServerEvents[\s\S]*text\/event-stream/u,
  );
  assert.match(
    serverEvents,
    /Reconnection and Last-Event-ID request policy remain explicit caller work/u,
  );
});

test("owns native accessibility through pinned modules without AccessibilityInfo.js", () => {
  const registry = read("../../../packages/accessibility/src/react-native.ts");
  const adapter = read(
    "../../../packages/accessibility/src/react-native-adapter.ts",
  );
  const solid = read("../../../packages/accessibility/src/solid.ts");

  assert.match(
    registry,
    /Libraries\/TurboModule\/TurboModuleRegistry[\s\S]*AccessibilityInfo[\s\S]*AccessibilityManager/u,
  );
  assert.doesNotMatch(
    `${registry}\n${adapter}`,
    /Libraries\/Components\/AccessibilityInfo|from ["']react["']|from ["']react-native["']/u,
  );
  assert.match(
    registry,
    /assertVerifiedReactNativePlatform[\s\S]*createAndroidAccessibilityAdapter[\s\S]*createIOSAccessibilityAdapter/u,
  );
  assert.match(
    adapter,
    /touchExplorationDidChange[\s\S]*accessibilityServiceDidChange[\s\S]*screenReaderChanged[\s\S]*reduceTransparencyChanged/u,
  );
  assert.match(
    solid,
    /platform\.accessibility\.preference[\s\S]*action\(function\*[\s\S]*onCleanup/u,
  );
});

test("stages mount-time layout routes and rolls them back with failed commits", () => {
  const iosBinding = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
  );
  const androidBinding = read(
    "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
  );

  for (const binding of [iosBinding, androidBinding]) {
    assert.match(
      binding,
      /stageLayoutRoutes\([\s\S]*events\.contains\("layout"\)[\s\S]*previousNodeForTag[\s\S]*previousTagForNode[\s\S]*previousEvents/u,
    );
    assert.match(
      binding,
      /rollbackLayoutRoutes\([\s\S]*stage\.nodes\.rbegin\(\)[\s\S]*stage\.previousSurface[\s\S]*stage\.previousSequence/u,
    );
  }
  assert.match(
    iosBinding,
    /layoutRouteStage = routing->stageLayoutRoutes\([\s\S]*applyTransaction:[\s\S]*if \(result == nil\) \{[\s\S]*rollbackLayoutRoutes\(layoutRouteStage\)[\s\S]*publishCommit\([\s\S]*finishLayoutRoutes\(layoutRouteStage\)/u,
  );
  assert.match(
    androidBinding,
    /layoutRouteStage = state->stageLayoutRoutes\([\s\S]*coordinator->apply\([\s\S]*catch \(\.\.\.\) \{[\s\S]*rollbackLayoutRoutes\(layoutRouteStage\)[\s\S]*publishCommit\([\s\S]*finishLayoutRoutes\(layoutRouteStage\)/u,
  );
});

test("routes the complete TextInput editing and scroll lifecycle", () => {
  const core = read("../../../packages/core/src/index.ts");
  const coordinator = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
  );
  const bindings = [
    read(
      "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
    ),
    read(
      "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
    ),
  ];

  assert.match(
    core,
    /createNativeComponentDescriptor\("TextInput", \{[\s\S]*bubblingEvents: \["endEditing", "keyPress", "scroll"\]/u,
  );
  assert.match(
    coordinator,
    /node\.component == "TextInput"[\s\S]*event == "scroll"[\s\S]*result\["onScroll"\] = true/u,
  );
  assert.match(
    coordinator,
    /event == "contentSizeChange" \|\| event == "endEditing" \|\|[\s\S]*event == "scroll"/u,
  );
  for (const binding of bindings) {
    assert.match(
      binding,
      /name == "endEditing" \|\| name == "keyPress"[\s\S]*name == "scroll"/u,
    );
    assert.match(binding, /if \(name == "scroll"\) return "continuous";/u);
  }
});

test("routes Pressable focus and hover lifecycle through Fabric", () => {
  const core = read("../../../packages/core/src/index.ts");
  const coordinator = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
  );
  const bindings = [
    read(
      "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
    ),
    read(
      "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
    ),
  ];

  assert.match(
    core,
    /createNativeComponentDescriptor\("Pressable", \{[\s\S]*directEvents: \[[\s\S]*"layout"[\s\S]*"focus"[\s\S]*"blur"[\s\S]*"hoverIn"[\s\S]*"hoverOut"[\s\S]*\.\.\.ACCESSIBILITY_DIRECT_EVENTS/u,
  );
  assert.match(
    coordinator,
    /node\.component == "Pressable" && event == "focus"[\s\S]*result\["onFocus"\] = true/u,
  );
  assert.match(
    coordinator,
    /node\.component == "Pressable" && event == "blur"[\s\S]*result\["onBlur"\] = true/u,
  );
  assert.match(
    coordinator,
    /node\.component == "Pressable"[\s\S]*event == "blur" \|\| event == "focus" \|\| event == "layout" \|\|[\s\S]*event == "hoverIn" \|\| event == "hoverOut"/u,
  );
  assert.match(
    coordinator,
    /event == "hoverIn"[\s\S]*result\["onPointerEnter"\] = true[\s\S]*event == "hoverOut"[\s\S]*result\["onPointerLeave"\] = true/u,
  );
  for (const binding of bindings) {
    assert.match(
      binding,
      /name == "pointerEnter"[\s\S]*"hoverIn"[\s\S]*name == "pointerLeave"[\s\S]*"hoverOut"/u,
    );
  }
});

test("routes native accessibility actions as discrete direct input", () => {
  const core = read("../../../packages/core/src/index.ts");
  const coordinator = read(
    "../../../packages/fabric-host/native/fabric/SolidNativeFabricTransactionCoordinator.cpp",
  );
  const bindings = [
    read(
      "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
    ),
    read(
      "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
    ),
  ];

  assert.match(
    core,
    /const ACCESSIBILITY_DIRECT_EVENTS = \[[\s\S]*"accessibilityAction"[\s\S]*"accessibilityEscape"[\s\S]*"accessibilityTap"[\s\S]*"magicTap"[\s\S]*\] as const/u,
  );
  assert.match(
    coordinator,
    /event == "accessibilityAction"[\s\S]*result\["onAccessibilityAction"\] = true/u,
  );
  assert.match(
    coordinator,
    /node\.kind == NodeRecord::Kind::Element &&[\s\S]*event == "accessibilityAction"/u,
  );
  assert.match(
    coordinator,
    /event == "accessibilityEscape"[\s\S]*result\["onAccessibilityEscape"\] = true[\s\S]*event == "accessibilityTap"[\s\S]*result\["onAccessibilityTap"\] = true[\s\S]*event == "magicTap"[\s\S]*result\["onAccessibilityMagicTap"\] = true/u,
  );
  for (const binding of bindings) {
    assert.match(
      binding,
      /name == "scrollEndDrag" \|\| name == "accessibilityAction"[\s\S]*name == "magicTap"[\s\S]*return "discrete"/u,
    );
  }
});
