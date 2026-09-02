#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_KEYBOARD_DERIVED_DATA:-"$IOS_DIR/build/device-keyboard-tests"}
PROFILE=${SOLID_NATIVE_IOS_KEYBOARD_PROFILE:-avoidance}
case "$PROFILE" in
  avoidance)
    ENTRY_FILE=keyboard.tsx
    BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_KEYBOARD_BUNDLE_ID:-dev.solidnative.keyboard}
    RESULT_NAME=SolidNativeKeyboard
    TEST_IDENTIFIER=SolidNativeE2EUITests/SolidNativeKeyboardUITests/testSoftwareKeyboardAvoidanceOnPhysicalDevice
    FAILURE_MARKER=SOLID_NATIVE_KEYBOARD_FAILED
    REQUIRED_MARKERS="
      SOLID_NATIVE_KEYBOARD_READY
      SOLID_NATIVE_KEYBOARD_LAYOUT_OBSERVED
      SOLID_NATIVE_KEYBOARD_METRICS_OBSERVED
      SOLID_NATIVE_KEYBOARD_AVOIDANCE_APPLIED
      SOLID_NATIVE_KEYBOARD_VISIBLE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_AVOIDANCE_CLEARED
      SOLID_NATIVE_KEYBOARD_AVOIDANCE_CAUSALITY_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_STATE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_TEARDOWN_SUCCEEDED
    "
    SUCCESS_DESCRIPTION="iPhone software-keyboard visibility, measured avoidance, frame restoration, causal privacy, submission, blur, and teardown"
    ;;
  focused-scroll)
    ENTRY_FILE=keyboard-scroll.tsx
    BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_KEYBOARD_SCROLL_BUNDLE_ID:-dev.solidnative.keyboard.scroll}
    RESULT_NAME=SolidNativeKeyboardFocusedScroll
    TEST_IDENTIFIER=SolidNativeE2EUITests/SolidNativeKeyboardUITests/testFocusedFieldScrollOnPhysicalDevice
    FAILURE_MARKER=SOLID_NATIVE_KEYBOARD_SCROLL_FAILED
    REQUIRED_MARKERS="
      SOLID_NATIVE_KEYBOARD_SCROLL_READY
      SOLID_NATIVE_KEYBOARD_SCROLL_METRICS_OBSERVED
      SOLID_NATIVE_KEYBOARD_FOCUS_VISIBILITY_APPLIED
      SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SCROLL_APPLIED
      SOLID_NATIVE_KEYBOARD_NATIVE_SCROLL_OBSERVED
      SOLID_NATIVE_KEYBOARD_SCROLL_VISIBLE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_STATE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_SCROLL_CAUSALITY_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_SCROLL_STATE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_SCROLL_TEARDOWN_SUCCEEDED
    "
    SUCCESS_DESCRIPTION="iPhone focused-field measurement, automatic native scrolling, Next/Done focus traversal, keyboard clearance, causal privacy, submission, blur, and teardown"
    ;;
  *)
    echo "Unknown iOS keyboard proof profile: $PROFILE" >&2
    exit 2
    ;;
esac
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/$RESULT_NAME-$(date +%Y%m%d-%H%M%S).xcresult"
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
  ENTRY_FILE="$ENTRY_FILE" \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  "-only-testing:$TEST_IDENTIFIER" \
  test
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-keyboard-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "$FAILURE_MARKER" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS $PROFILE keyboard proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in $REQUIRED_MARKERS
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS keyboard physical-device proof marker: $marker" >&2
    exit 1
  fi
done

echo "Verified $SUCCESS_DESCRIPTION on $SOLID_NATIVE_IOS_DESTINATION."
