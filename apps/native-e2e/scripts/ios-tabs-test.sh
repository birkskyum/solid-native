#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_TABS_DERIVED_DATA:-"$IOS_DIR/build/device-tabs-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_TABS_BUNDLE_ID:-dev.solidnative.tabs}
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeTabs-$(date +%Y%m%d-%H%M%S).xcresult"
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
  ENTRY_FILE=tabs.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeTabsOnPhysicalDevice \
  test
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-tabs-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_TABS_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS native-tabs proof emitted its JavaScript failure marker." >&2
  exit 1
fi
if grep -R -F -q "SOLID_NATIVE_IOS_TABS_APPEARANCE_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS native-tabs proof emitted its native appearance failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_TABS_READY \
  SOLID_NATIVE_TABS_SELECTION_SUCCEEDED \
  SOLID_NATIVE_TABS_PROCESS_SEED_SUCCEEDED \
  SOLID_NATIVE_TABS_PLATFORM_CANCEL_SUCCEEDED \
  SOLID_NATIVE_TABS_PROCESS_RESTORATION_SUCCEEDED \
  SOLID_NATIVE_TABS_DISCARDED_STORAGE_CLEARED \
  SOLID_NATIVE_TABS_PLATFORM_BLOCKED_SUCCEEDED \
  SOLID_NATIVE_TABS_BLOCKER_RELEASED \
  SOLID_NATIVE_TABS_PLATFORM_GESTURE_SUCCEEDED \
  SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_IOS_TABS_PROOF_INITIAL_IMAGE_SUCCEEDED \
  SOLID_NATIVE_IOS_TABS_PROOF_NONE_SUCCEEDED \
  SOLID_NATIVE_IOS_TABS_PROOF_RESOURCE_SUCCEEDED \
  SOLID_NATIVE_IOS_TABS_PROOF_RACE_NONE_SUCCEEDED \
  SOLID_NATIVE_IOS_TABS_PROOF_STABLE_NONE_SUCCEEDED \
  SOLID_NATIVE_IOS_TABS_PROOF_RESTORED_RESOURCE_SUCCEEDED \
  SOLID_NATIVE_IOS_TABS_PROOF_RESTORED_IMAGE_SUCCEEDED \
  SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS native-tabs physical-device proof marker: $marker" >&2
    exit 1
  fi
done

PROCESS_COUNT=$(
  grep -R -a -h -o "SOLID_NATIVE_APP_PROCESS_ID_[0-9]*" "$DIAGNOSTICS_DIRECTORY" |
    sort -u |
    awk 'NF { count++ } END { print count + 0 }'
)
if [ "$PROCESS_COUNT" -ne 4 ]; then
  echo "Expected exactly four distinct iOS native-tabs app processes; found $PROCESS_COUNT." >&2
  exit 1
fi

echo "Verified iPhone native tabs, retained Solid owners, UITabBar appearance and image ownership, selected-stack cancellation and blocking, process restoration, cold-link precedence, persistence, and teardown on $SOLID_NATIVE_IOS_DESTINATION."
