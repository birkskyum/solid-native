#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_NAVIGATION_MODAL_DERIVED_DATA:-"$IOS_DIR/build/device-navigation-modal-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_NAVIGATION_MODAL_BUNDLE_ID:-dev.solidnative.navigation.modal}
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeNavigationModal-$(date +%Y%m%d-%H%M%S).xcresult"
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
  ENTRY_FILE=navigation-modal.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeNavigationModalUITests/testStandaloneNavigationModalOnPhysicalDevice \
  test
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-navigation-modal-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_NAVIGATION_MODAL_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS standalone navigation-modal proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_NAVIGATION_MODAL_READY \
  SOLID_NATIVE_NAVIGATION_MODAL_SHOW_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_MODAL_BLOCKED_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_MODAL_SWIPE_ENABLED \
  SOLID_NATIVE_NAVIGATION_MODAL_REQUEST_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_MODAL_PLATFORM_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_MODAL_DISMISS_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_MODAL_HIDDEN_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_MODAL_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS standalone navigation-modal proof marker: $marker" >&2
    exit 1
  fi
done

PROCESS_COUNT=$(
  grep -R -a -h -o "SOLID_NATIVE_APP_PROCESS_ID_[0-9]*" "$DIAGNOSTICS_DIRECTORY" |
    sort -u |
    awk 'NF { count++ } END { print count + 0 }'
)
if [ "$PROCESS_COUNT" -ne 1 ]; then
  echo "Expected exactly one iOS standalone navigation-modal app process; found $PROCESS_COUNT." >&2
  exit 1
fi

echo "Verified Solid-owned iPhone standalone modal routing, blocker policy, physical UIKit dismissal, owner retention, and teardown on $SOLID_NATIVE_IOS_DESTINATION."
