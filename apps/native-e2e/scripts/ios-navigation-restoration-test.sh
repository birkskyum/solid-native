#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_NAVIGATION_DERIVED_DATA:-"$IOS_DIR/build/device-navigation-restoration-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_NAVIGATION_BUNDLE_ID:-dev.solidnative.navigation}
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeNavigation-$(date +%Y%m%d-%H%M%S).xcresult"
SOURCE_MAP_PATH="$DERIVED_DATA_PATH/navigation-restoration.ios.bundle.map"
DIAGNOSTICS_PARENT=

cleanup() {
  stop_solid_native_ios_process_guard
  if [ -n "$DIAGNOSTICS_PARENT" ]; then
    rm -rf "$DIAGNOSTICS_PARENT"
  fi
}

: "${SOLID_NATIVE_IOS_DESTINATION:?Set SOLID_NATIVE_IOS_DESTINATION to the connected device identifier shown by xcrun xctrace list devices.}"
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
  ENTRY_FILE=navigation-restoration.tsx \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNavigationProcessRestorationOnPhysicalDevice \
  build-for-testing

node "$APP_DIR/scripts/verify-solid-runtime-sourcemap.mjs" "$SOURCE_MAP_PATH"
node "$APP_DIR/scripts/verify-navigation-sourcemap.mjs" \
  "$SOURCE_MAP_PATH" navigation-restoration.tsx

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
  ENTRY_FILE=navigation-restoration.tsx \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNavigationProcessRestorationOnPhysicalDevice \
  test-without-building
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-navigation-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_NAVIGATION_PROCESS_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS navigation-process proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_NAVIGATION_PROCESS_READY \
  SOLID_NATIVE_NAVIGATION_PROCESS_ROUTER_READY \
  SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_SEED_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_CANCEL_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_ACTION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_MENU_ACTION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_RESTORATION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BLOCKED_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_BLOCKER_RELEASED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_GESTURE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_DISCARDED_STORAGE_CLEARED \
  SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS navigation-process proof marker: $marker" >&2
    exit 1
  fi
done

PROCESS_COUNT=$(
  grep -R -a -h -o "SOLID_NATIVE_APP_PROCESS_ID_[0-9]*" "$DIAGNOSTICS_DIRECTORY" |
    sort -u |
    awk 'NF { count++ } END { print count + 0 }'
)
if [ "$PROCESS_COUNT" -ne 3 ]; then
  echo "Expected exactly three distinct iOS navigation app processes; found $PROCESS_COUNT." >&2
  exit 1
fi

echo "Verified single-stack iPhone navigation and durable scroll restoration, bounded preload, native Back, cold-link precedence, persistence, and teardown on $SOLID_NATIVE_IOS_DESTINATION."
