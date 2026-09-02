import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function readQuotedAssignment(source, name) {
  const match = source.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, "m"));
  assert.ok(match, `expected a quoted ${name} assignment`);
  return match[1];
}

test("keeps the Android Gradle, Kotlin, and KSP toolchains aligned", () => {
  const rootBuild = read("../android/build.gradle");
  const reactNativeVersions = read(
    "../node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml",
  );
  const asyncStorageConfig = read(
    "../node_modules/@react-native-async-storage/async-storage/android/config.gradle",
  );

  const agpVersion = readQuotedAssignment(rootBuild, "agpVersion");
  const kotlinVersion = readQuotedAssignment(rootBuild, "kotlinVersion");

  assert.equal(
    agpVersion,
    readQuotedAssignment(reactNativeVersions, "agp"),
    "the app's AGP must match the React Native Gradle plugin",
  );
  assert.equal(
    kotlinVersion,
    "2.2.10",
    "AGP 9.2.1 loads Kotlin 2.2.10 on the build classpath",
  );
  assert.match(
    asyncStorageConfig,
    new RegExp(`"${kotlinVersion.replaceAll(".", "\\.")}-[^"]+"`),
    "AsyncStorage must provide a KSP release for the selected Kotlin version",
  );
  assert.match(
    rootBuild,
    /com\.android\.built-in-kotlin\.gradle\.plugin:\$\{agpVersion\}/,
  );
});

test("keeps third-party Kotlin compatibility isolated from the app module", () => {
  const appBuild = read("../android/app/build.gradle");
  const properties = read("../android/gradle.properties");
  const asyncStorageBuild = read(
    "../node_modules/@react-native-async-storage/async-storage/android/build.gradle",
  );

  assert.match(appBuild, /apply plugin: "com\.android\.built-in-kotlin"/);
  assert.doesNotMatch(
    appBuild,
    /org\.jetbrains\.kotlin\.android|kotlin-android/,
  );
  assert.match(asyncStorageBuild, /apply plugin: "kotlin-android"/);
  assert.match(properties, /^android\.builtInKotlin=false$/m);
  assert.match(properties, /^android\.newDsl=false$/m);
});

test("keeps native-tabs event priorities aligned across Fabric adapters", () => {
  const adapters = [
    read(
      "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
    ),
    read(
      "../../../packages/fabric-host/native/fabric/SolidNativeFabricJSIBinding.mm",
    ),
  ];

  for (const adapter of adapters) {
    assert.match(
      adapter,
      /name == "tabSelected"[\s\S]*name == "tabSelectionRejected"[\s\S]*name == "tabSelectionPrevented"[\s\S]*return "discrete";/,
    );
    assert.match(
      adapter,
      /name == "willAppear"[\s\S]*name == "didAppear"[\s\S]*name == "willDisappear"[\s\S]*name == "didDisappear"[\s\S]*name == "moreTabSelected"[\s\S]*return "default";/,
    );
  }
});

test("tracks the selected physical entrypoint as a Gradle bundle input", () => {
  const application = read("../android/app/build.gradle");
  assert.match(
    application,
    /providers\.environmentVariable\("ENTRY_FILE"\)[\s\S]+\.orElse\("index\.tsx"\)/u,
  );
  assert.match(
    application,
    /entryFile = file\("\.\.\/\.\.\/\$\{solidNativeEntryFile\}"\)/u,
  );
});

test("consumes the package-owned Android Fabric Host seam", () => {
  const appBuild = read("../android/app/build.gradle");
  const appCmake = read("../android/app/src/main/jni/CMakeLists.txt");
  const onLoad = read("../android/app/src/main/jni/OnLoad.cpp");
  const runtimeGradle = read(
    "../../../packages/fabric-host/native/android/solid-native.gradle",
  );
  const runtimeCmake = read(
    "../../../packages/fabric-host/native/android/SolidNativeRuntime.cmake",
  );
  const installer = read(
    "../../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativeBindingsInstaller.kt",
  );
  const debugModule = read(
    "../../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativeDebugModule.kt",
  );
  const platformModule = read(
    "../../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativePlatformModule.kt",
  );
  const runtimePackage = read(
    "../../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativePackage.kt",
  );
  const nativeInstaller = read(
    "../../../packages/fabric-host/native/android/SolidNativeBindingsInstaller.cpp",
  );
  const productionSurface = read(
    "../../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativeSurface.kt",
  );
  const startupFailureView = read(
    "../../../packages/fabric-host/native/android/java/dev/solidnative/runtime/SolidNativeStartupFailureView.kt",
  );
  const mainActivity = read(
    "../android/app/src/main/java/dev/solidnative/e2e/MainActivity.kt",
  );
  const mainApplication = read(
    "../android/app/src/main/java/dev/solidnative/e2e/MainApplication.kt",
  );
  const developmentEntry = read("../dev-entry.tsx");
  const diagnosticsEntry = read("../diagnostics.tsx");
  const debugSpec = read("../specs/NativeSolidNativeDebug.ts");
  const platformSpec = read("../specs/NativeSolidNativePlatformAndroid.ts");

  assert.match(
    appBuild,
    /require\.resolve\('@solid-native\/fabric-host\/android-gradle'\)[\s\S]*apply from: solidNativeAndroidGradle/,
  );
  assert.doesNotMatch(appBuild, /sourceSets\.named\("main"\)/);
  assert.match(
    runtimeGradle,
    /sourceSets\.named\("main"\)[\s\S]*kotlin\.directories\.add/,
  );
  assert.match(
    runtimeGradle,
    /org\.jetbrains\.kotlin\.android[\s\S]*sourceSet\.java\.srcDir/,
  );
  assert.match(
    runtimeGradle,
    /-DSOLID_NATIVE_FABRIC_HOST_DIR=\$\{fabricHostDirectory\.absolutePath\}/,
  );
  assert.match(
    runtimeGradle,
    /react-native-boundary\.json[\s\S]*JsonSlurper[\s\S]*-DSOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR=[\s\S]*-DSOLID_NATIVE_REACT_NATIVE_VERSION_MINOR=[\s\S]*-DSOLID_NATIVE_REACT_NATIVE_VERSION_PATCH=/u,
  );
  assert.doesNotMatch(
    appBuild,
    /packages\/(?:fabric-host|runtime)\/native\/android/,
    "the app must resolve native sources through the installed package",
  );
  assert.match(
    appCmake,
    /SOLID_NATIVE_FABRIC_HOST_DIR must point to the installed @solid-native\/fabric-host package/,
  );
  assert.match(
    appCmake,
    /include\("\$\{SOLID_NATIVE_ANDROID_DIR\}\/SolidNativeRuntime\.cmake"\)/,
  );
  assert.doesNotMatch(appCmake, /SOLID_NATIVE_REPO_ROOT/);
  assert.match(
    appCmake,
    /solid_native_configure_android_target\(\$\{CMAKE_PROJECT_NAME\}\)/,
  );
  assert.match(onLoad, /#include "SolidNativeBindingsInstaller\.h"/);
  assert.match(
    runtimeCmake,
    /SolidNativeBindingsInstaller\.cpp[\s\S]*SolidNativeFabricApi\.cpp[\s\S]*SolidNativeUIWorklet\.cpp/,
  );
  assert.match(
    runtimeCmake,
    /target_compile_definitions[\s\S]*SOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR/u,
  );
  assert.match(installer, /^package dev\.solidnative\.runtime$/m);
  assert.match(
    debugModule,
    /RECEIVER_NOT_EXPORTED[\s\S]*pendingRequestIds\.remove\(requestId\)[\s\S]*MAX_SNAPSHOT_BYTES[\s\S]*renameTo\(response\)[\s\S]*FLAG_DEBUGGABLE/u,
  );
  assert.match(
    debugModule,
    /getStringExtra\(OPERATION_EXTRA\)[\s\S]*operation !in ALLOWED_OPERATIONS[\s\S]*getStringExtra\(SESSION_ID_EXTRA\)[\s\S]*putString\("operation", operation\)[\s\S]*putString\("sessionId", sessionId\)[\s\S]*OPERATION_SOLID_DIAGNOSTICS_BEGIN[\s\S]*ALLOWED_OPERATIONS/u,
  );
  assert.match(
    runtimePackage,
    /BaseReactPackage[\s\S]*getModule[\s\S]*SolidNativeDebugModule\(reactContext\)[\s\S]*ReactModuleInfo/u,
  );
  assert.match(debugModule, /NativeSolidNativeDebugSpec\(context\)/u);
  assert.match(
    platformModule,
    /NativeSolidNativePlatformAndroidSpec\(context\)[\s\S]*hasActiveReactInstance\(\)[\s\S]*emitOnMemoryWarning\(event\)/u,
  );
  assert.match(
    platformModule,
    /level in RUNNING_LOW\.\.RUNNING_CRITICAL \|\| level >= BACKGROUND/u,
  );
  assert.match(
    debugSpec,
    /NativeDebugRequest[\s\S]*operation: string[\s\S]*sessionId\?: string[\s\S]*TurboModuleRegistry\.getEnforcing<Spec>\("SolidNativeDebug"\)/u,
  );
  assert.match(
    platformSpec,
    /EventEmitter<MemoryWarningEvent>[\s\S]*getEnforcing<Spec>\([\s\S]*"SolidNativePlatformAndroid"/u,
  );
  assert.match(
    nativeInstaller,
    /setRuntimeRetirementHandler\([\s\S]*retireRuntime\(runtimeGeneration\)/u,
  );
  assert.match(
    nativeInstaller,
    /void retireRuntime\(uint64_t generation\)[\s\S]*mountObserver->detach\(\)[\s\S]*coordinator->reset\(\)/u,
  );
  assert.match(
    nativeInstaller,
    /"reportFatalError"[\s\S]*MaximumFatalErrorNameBytes[\s\S]*requestJavaFatalError/u,
  );
  assert.match(
    productionSurface,
    /class SolidNativeSurface private constructor/u,
  );
  assert.match(
    productionSurface,
    /deactivateSurface\(currentSurfaceId\)[\s\S]*surface\.stop\(\)[\s\S]*task\.isCompleted[\s\S]*clearSurface\(currentSurfaceId\)/u,
  );
  assert.match(
    productionSurface,
    /setFatalErrorHandler\(::showFatalFromHost\)[\s\S]*reportStatus\("runtime-failed"[\s\S]*beginStop\(\)[\s\S]*SolidNativeStartupFailureView\.show/u,
  );
  assert.match(
    startupFailureView,
    /FLAG_DEBUGGABLE[\s\S]*GENERIC_MESSAGE[\s\S]*MAX_DIAGNOSTIC_LENGTH/u,
  );
  assert.match(
    startupFailureView,
    /setContentView\(view\)[\s\S]*requestFocus\(\)/u,
  );
  assert.doesNotMatch(startupFailureView, /com\.facebook|solid-js/u);
  assert.match(mainActivity, /SolidNativeSurface\.start\(/u);
  assert.match(
    mainActivity,
    /onConfigurationChanged\(newConfig: Configuration\)[\s\S]*super\.onConfigurationChanged\(newConfig\)[\s\S]*reactHost\.onConfigurationChanged\(this\)/u,
  );
  assert.match(appBuild, /solid \{[\s\S]*SOLID_NATIVE_DEV_RELOAD", "true"/u);
  assert.match(
    appBuild,
    /solidDevtools \{[\s\S]*SOLID_NATIVE_DEVTOOLS", "true"/u,
  );
  assert.match(
    mainApplication,
    /BuildConfig\.DEBUG && BuildConfig\.SOLID_NATIVE_DEVTOOLS[\s\S]*"devtools"[\s\S]*BuildConfig\.DEBUG && BuildConfig\.SOLID_NATIVE_DEV_RELOAD[\s\S]*"dev-entry"/u,
  );
  assert.match(
    appBuild,
    /solidDiagnostics \{[\s\S]*dev\.solidnative\.diagnostics[\s\S]*SOLID_NATIVE_DIAGNOSTICS", "true"/u,
  );
  assert.match(
    mainApplication,
    /BuildConfig\.DEBUG && BuildConfig\.SOLID_NATIVE_DIAGNOSTICS[\s\S]*"diagnostics"/u,
  );
  assert.match(mainApplication, /SolidNativePackage\(\)/u);
  assert.match(
    mainApplication,
    /onTrimMemory\(level: Int\)[\s\S]*SolidNativeMemoryWarning\.handleTrimMemory\(level\)[\s\S]*onLowMemory\(\)[\s\S]*SolidNativeMemoryWarning\.handleLowMemory\(\)/u,
  );
  assert.match(
    developmentEntry,
    /createDevelopmentSolidDiagnosticsController[\s\S]*createCausalTimeline\(\)[\s\S]*createReactNativeCausalDebugTransport\(timeline[\s\S]*solidDiagnostics:[\s\S]*telemetry,/u,
  );
  assert.match(
    diagnosticsEntry,
    /solid-native\.diagnostics\.counter[\s\S]*solid-native\.diagnostics\.output[\s\S]*createSignal\(0,[\s\S]*CausalComputation[\s\S]*createDevelopmentSolidDiagnosticsController/u,
  );
  assert.doesNotMatch(
    mainActivity,
    /setSurfaceStopHandler|setUIWorkletOutputHandler|publishSurface/u,
  );
});
