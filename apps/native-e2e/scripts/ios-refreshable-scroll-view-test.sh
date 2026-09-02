#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_REFRESH_DERIVED_DATA:-"$IOS_DIR/build/device-refresh-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_REFRESH_BUNDLE_ID:-dev.solidnative.e2e}
SOURCE_MAP_PATH="$DERIVED_DATA_PATH/refreshable-scroll-view.ios.bundle.map"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2E.app"
TEST_BUNDLE_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2EUITests-Runner.app/PlugIns/SolidNativeE2EUITests.xctest"
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeRefresh-$(date +%Y%m%d-%H%M%S).xcresult"
DIAGNOSTICS_PARENT=

cleanup() {
  stop_solid_native_ios_process_guard
  if [ -n "$DIAGNOSTICS_PARENT" ]; then
    rm -rf "$DIAGNOSTICS_PARENT"
  fi
}

: "${SOLID_NATIVE_IOS_DESTINATION:?Set SOLID_NATIVE_IOS_DESTINATION to the connected CoreDevice identifier.}"
: "${SOLID_NATIVE_IOS_TEAM:?Set SOLID_NATIVE_IOS_TEAM to the Apple Development team identifier selected in Xcode.}"
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-device-preflight.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-host-preflight.mjs"
pnpm --dir "$REPO_ROOT" --filter '@solid-native/native-e2e...' build
ensure_solid_native_ios_pods
mkdir -p "$RESULTS_DIRECTORY"

xcodebuild \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Release \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  ENTRY_FILE=refreshable-scroll-view.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testRefreshableScrollViewOnPhysicalDevice \
  clean build-for-testing

node "$APP_DIR/scripts/verify-solid-runtime-sourcemap.mjs" "$SOURCE_MAP_PATH"
node "$APP_DIR/scripts/verify-refreshable-scroll-view-sourcemap.mjs" "$SOURCE_MAP_PATH"

if [ ! -d "$APP_PATH" ] || [ ! -d "$TEST_BUNDLE_PATH" ]; then
  echo "The signed iOS pull-to-refresh app or UI-test bundle is missing after build-for-testing." >&2
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

start_solid_native_ios_process_guard
set +e
xcodebuild \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Release \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  ENTRY_FILE=refreshable-scroll-view.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testRefreshableScrollViewOnPhysicalDevice \
  test-without-building
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-refresh-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_REFRESHABLE_SCROLL_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS pull-to-refresh proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_REFRESHABLE_SCROLL_READY \
  SOLID_NATIVE_REFRESHABLE_SCROLL_REJECTED_SUCCEEDED \
  SOLID_NATIVE_REFRESHABLE_SCROLL_ACCEPTED_SUCCEEDED \
  SOLID_NATIVE_REFRESHABLE_SCROLL_COMPLETED_SUCCEEDED \
  SOLID_NATIVE_REFRESHABLE_SCROLL_IDENTITY_SUCCEEDED \
  SOLID_NATIVE_REFRESHABLE_SCROLL_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS pull-to-refresh physical-device proof marker: $marker" >&2
    exit 1
  fi
done

echo "Verified physical iPhone pull-to-refresh rejection, controlled acceptance/completion, retained backing ScrollView handle, and teardown on $SOLID_NATIVE_IOS_DESTINATION."
