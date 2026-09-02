#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_FABRIC_HOST_DERIVED_DATA:-"$IOS_DIR/build/device-fabric-host"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_FABRIC_HOST_BUNDLE_ID:-dev.solidnative.fabric-host}
UNLOCK_WAIT_SECONDS=${SOLID_NATIVE_IOS_FABRIC_HOST_UNLOCK_WAIT_SECONDS:-300}
SOURCE_MAP_PATH="$DERIVED_DATA_PATH/fabric-host.ios.bundle.map"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2E.app"
TEST_BUNDLE_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2EUITests-Runner.app/PlugIns/SolidNativeE2EUITests.xctest"
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeFabricHost-$(date +%Y%m%d-%H%M%S).xcresult"
DIAGNOSTICS_PARENT=
INVENTORY_PARENT=
INSTALL_ATTEMPTED=0

cleanup() {
  stop_solid_native_ios_process_guard
  if [ "$INSTALL_ATTEMPTED" -eq 1 ]; then
    xcrun devicectl device uninstall app \
      --device "$SOLID_NATIVE_IOS_DESTINATION" \
      --quiet \
      "$BUNDLE_IDENTIFIER" >/dev/null 2>&1 || true
  fi
  if [ -n "$DIAGNOSTICS_PARENT" ]; then
    rm -rf "$DIAGNOSTICS_PARENT"
  fi
  if [ -n "$INVENTORY_PARENT" ]; then
    rm -rf "$INVENTORY_PARENT"
  fi
}

: "${SOLID_NATIVE_IOS_DESTINATION:?Set SOLID_NATIVE_IOS_DESTINATION to the connected CoreDevice identifier.}"
: "${SOLID_NATIVE_IOS_TEAM:?Set SOLID_NATIVE_IOS_TEAM to the Apple Development team identifier selected in Xcode.}"
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

case "$UNLOCK_WAIT_SECONDS" in
  ''|*[!0-9]*)
    echo "SOLID_NATIVE_IOS_FABRIC_HOST_UNLOCK_WAIT_SECONDS must be an integer from 1 through 600." >&2
    exit 1
    ;;
esac
if [ "$UNLOCK_WAIT_SECONDS" -lt 1 ] || [ "$UNLOCK_WAIT_SECONDS" -gt 600 ]; then
  echo "SOLID_NATIVE_IOS_FABRIC_HOST_UNLOCK_WAIT_SECONDS must be an integer from 1 through 600." >&2
  exit 1
fi

node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-device-preflight.mjs" "$SOLID_NATIVE_IOS_DESTINATION" \
  --wait-seconds "$UNLOCK_WAIT_SECONDS"
node "$APP_DIR/scripts/ios-host-preflight.mjs"

INVENTORY_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-fabric-host-inventory.XXXXXX")
INITIAL_INVENTORY_PATH="$INVENTORY_PARENT/initial.json"
xcrun devicectl device info apps \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --bundle-id "$BUNDLE_IDENTIFIER" \
  --json-output "$INITIAL_INVENTORY_PATH" \
  --quiet
if [ "$(plutil -extract result.apps raw "$INITIAL_INVENTORY_PATH")" -ne 0 ]; then
  echo "Refusing to replace an installed iOS application with bundle identifier $BUNDLE_IDENTIFIER." >&2
  exit 1
fi

pnpm --dir "$REPO_ROOT" --filter '@solid-native/native-e2e...' build
ensure_solid_native_ios_pods
mkdir -p "$RESULTS_DIRECTORY"

xcodebuild \
  -quiet \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Release \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  ENTRY_FILE=fabric-host.ts \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -only-testing:SolidNativeE2EUITests/SolidNativeReloadUITests/testFrameworkFreeFabricHostOnPhysicalDevice \
  clean build-for-testing

node "$APP_DIR/scripts/verify-framework-free-fabric-host-sourcemap.mjs" "$SOURCE_MAP_PATH"

if [ ! -d "$APP_PATH" ] || [ ! -d "$TEST_BUNDLE_PATH" ]; then
  echo "The signed iOS Fabric Host app or UI-test bundle is missing after build-for-testing." >&2
  exit 1
fi

ACTUAL_BUNDLE_IDENTIFIER=$(
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist"
)
if [ "$ACTUAL_BUNDLE_IDENTIFIER" != "$BUNDLE_IDENTIFIER" ]; then
  echo "Expected iOS app bundle identifier $BUNDLE_IDENTIFIER; found $ACTUAL_BUNDLE_IDENTIFIER." >&2
  exit 1
fi

/usr/bin/codesign --verify --deep --strict "$APP_PATH"
/usr/bin/codesign --verify --deep --strict "$TEST_BUNDLE_PATH"

# A signed build can outlast Auto-Lock. Revalidate mutable device and host state
# at the final safe boundary before XCTest installs the isolated proof app.
node "$APP_DIR/scripts/ios-device-preflight.mjs" "$SOLID_NATIVE_IOS_DESTINATION" \
  --wait-seconds "$UNLOCK_WAIT_SECONDS"
node "$APP_DIR/scripts/ios-host-preflight.mjs"
start_solid_native_ios_process_guard
INSTALL_ATTEMPTED=1
set +e
xcodebuild \
  -quiet \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Release \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  ENTRY_FILE=fabric-host.ts \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeReloadUITests/testFrameworkFreeFabricHostOnPhysicalDevice \
  test-without-building
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-fabric-host-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_FABRIC_HOST_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS framework-free Fabric Host emitted a JavaScript failure marker." >&2
  exit 1
fi
for marker in \
  SOLID_NATIVE_FABRIC_HOST_READY \
  SOLID_NATIVE_FABRIC_HOST_UPDATE_SUCCEEDED \
  SOLID_NATIVE_FABRIC_HOST_FRAME_SUCCEEDED \
  SOLID_NATIVE_FABRIC_HOST_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS framework-free Fabric Host marker: $marker" >&2
    exit 1
  fi
done

node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
xcrun devicectl device uninstall app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  "$BUNDLE_IDENTIFIER"
FINAL_INVENTORY_PATH="$INVENTORY_PARENT/final.json"
xcrun devicectl device info apps \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --bundle-id "$BUNDLE_IDENTIFIER" \
  --json-output "$FINAL_INVENTORY_PATH" \
  --quiet
if [ "$(plutil -extract result.apps raw "$FINAL_INVENTORY_PATH")" -ne 0 ]; then
  echo "The disposable iOS framework-free Fabric Host application remained installed." >&2
  exit 1
fi
INSTALL_ATTEMPTED=0
stop_solid_native_ios_process_guard
echo "Verified framework-free Fabric Host mount, physical event, native update, lifecycle, exact teardown, and uninstall on $SOLID_NATIVE_IOS_DESTINATION."
