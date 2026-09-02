#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_WORKLET_DERIVED_DATA:-"$IOS_DIR/build/device-worklet-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_WORKLET_BUNDLE_ID:-dev.solidnative.worklet}
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeWorklet-$(date +%Y%m%d-%H%M%S).xcresult"
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
  ENTRY_FILE=worklet.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeUIWorkletOnPhysicalDevice \
  test
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-worklet-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

for marker in \
  SOLID_NATIVE_PRODUCT_ANIMATION_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_DECODER_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_CONFORMANCE_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_INITIAL_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_UPDATE_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_TIMING_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_CANCELLATION_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_KEYFRAMES_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_SPRING_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_DECAY_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_PAN_ATTACHED \
  SOLID_NATIVE_UI_WORKLET_PAN_DETACHED \
  SOLID_NATIVE_UI_WORKLET_PAN_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS native UI worklet proof marker: $marker" >&2
    exit 1
  fi
done

stability_json=$(grep -R -a -h -F "SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED" "$DIAGNOSTICS_DIRECTORY" | node "$APP_DIR/scripts/parse-worklet-stability.mjs")
printf 'Native UI worklet stability: %s\n' "$stability_json"
echo "Verified the product animation ref, native graph decoding, synchronous driver cancellation, sustained CADisplayLink UIView output, bounded keyframe sequencing, analytical spring and decay drivers, reversible UI-thread pan ownership, and teardown on $SOLID_NATIVE_IOS_DESTINATION."
