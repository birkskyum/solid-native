#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_TABS_PRODUCT_DERIVED_DATA:-"$IOS_DIR/build/device-tabs-product-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_TABS_BUNDLE_ID:-dev.solidnative.tabs}
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeTabsProduct-$(date +%Y%m%d-%H%M%S).xcresult"
SOURCE_MAP_PATH="$DERIVED_DATA_PATH/tabs.ios.bundle.map"
DIAGNOSTICS_PARENT=

cleanup() {
  stop_solid_native_ios_process_guard
  if [ -n "$DIAGNOSTICS_PARENT" ]; then
    rm -rf "$DIAGNOSTICS_PARENT"
  fi
}

: "${SOLID_NATIVE_IOS_DESTINATION:?Set SOLID_NATIVE_IOS_DESTINATION to the connected device identifier shown by xcrun devicectl list devices.}"
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
  ENTRY_FILE=tabs.tsx \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeTabsProductCompositionOnPhysicalDevice \
  build-for-testing

node "$APP_DIR/scripts/verify-solid-runtime-sourcemap.mjs" "$SOURCE_MAP_PATH"
node "$APP_DIR/scripts/verify-navigation-sourcemap.mjs" \
  "$SOURCE_MAP_PATH" tabs.tsx

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
  ENTRY_FILE=tabs.tsx \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeTabsProductCompositionOnPhysicalDevice \
  test-without-building
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-tabs-product-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_TABS_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS native-tabs product proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_TABS_READY \
  SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_STORED \
  SOLID_NATIVE_TABS_PRODUCT_LINK_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_COMPOSITION_SUCCEEDED \
  SOLID_NATIVE_TABS_PLATFORM_GESTURE_SUCCEEDED \
  SOLID_NATIVE_TABS_SELECTION_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORED \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORE_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED \
  SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS native-tabs product proof marker: $marker" >&2
    exit 1
  fi
done

PROCESS_COUNT=$(
  grep -R -a -h -o "SOLID_NATIVE_APP_PROCESS_ID_[0-9]*" "$DIAGNOSTICS_DIRECTORY" |
    sort -u |
    awk 'NF { count++ } END { print count + 0 }'
)
if [ "$PROCESS_COUNT" -ne 2 ]; then
  echo "Expected exactly two iOS native-tabs product app processes; found $PROCESS_COUNT." >&2
  exit 1
fi

echo "Verified protected launch, Keychain session restoration in a fresh process, typed async link, interrupted route, native tabs/stack/sheet composition, platform Back, state retention, secure logout, and teardown on $SOLID_NATIVE_IOS_DESTINATION."
