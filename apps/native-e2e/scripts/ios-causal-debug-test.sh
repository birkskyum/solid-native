#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_CAUSAL_DEBUG_DERIVED_DATA:-"$IOS_DIR/build/device-causal-debug"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_BUNDLE_ID:-dev.solidnative.e2e}
SNAPSHOT_DIRECTORY="$APP_DIR/build/device-proofs"
SNAPSHOT_PATH="$SNAPSHOT_DIRECTORY/ios-causal-debug-snapshot.json"
DIAGNOSTICS_PATH="$SNAPSHOT_DIRECTORY/ios-solid-diagnostics.json"
REPORT_PATH="$SNAPSHOT_DIRECTORY/ios-solid-diagnostics-report.html"

cleanup() {
  stop_solid_native_ios_process_guard
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
(
  cd "$IOS_DIR"
  pod install
)

xcodebuild \
  -quiet \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Debug \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  ENTRY_FILE=diagnostics.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  build

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug-iphoneos/SolidNativeE2E.app"
node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
xcrun devicectl device install app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  "$APP_PATH"
start_solid_native_ios_process_guard
mkdir -p "$SNAPSHOT_DIRECTORY"
rm -f "$SNAPSHOT_PATH" "$DIAGNOSTICS_PATH" "$REPORT_PATH"
xcrun devicectl device process launch \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --terminate-existing \
  "$BUNDLE_IDENTIFIER" \
  --solid-native-use-bundled-development

attempt=1
ready=false
while [ "$attempt" -le 20 ]; do
  if node "$REPO_ROOT/packages/cli/dist/bin.js" debug capture-ios \
    "$BUNDLE_IDENTIFIER" \
    --device "$SOLID_NATIVE_IOS_DESTINATION" \
    --timeout 5000 >"$SNAPSHOT_PATH" 2>/dev/null && \
    node "$APP_DIR/scripts/causal-debug-physical-proof.mjs" \
      "$SNAPSHOT_PATH" 2>/dev/null
  then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

if [ "$ready" != true ]; then
  echo "The iOS app did not retain a complete causal frame within 20 bounded captures." >&2
  exit 1
fi

node "$REPO_ROOT/packages/cli/dist/bin.js" debug diagnostics-ios \
  "$BUNDLE_IDENTIFIER" \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --duration 1200 \
  --timeout 5000 >"$DIAGNOSTICS_PATH"
node "$APP_DIR/scripts/solid-diagnostics-physical-proof.mjs" \
  "$DIAGNOSTICS_PATH"

attempt=1
correlated=false
while [ "$attempt" -le 20 ]; do
  if node "$REPO_ROOT/packages/cli/dist/bin.js" debug capture-ios \
    "$BUNDLE_IDENTIFIER" \
    --device "$SOLID_NATIVE_IOS_DESTINATION" \
    --timeout 5000 >"$SNAPSHOT_PATH" 2>/dev/null && \
    node "$APP_DIR/scripts/causal-debug-physical-proof.mjs" \
      "$SNAPSHOT_PATH" 2>/dev/null && \
    node "$APP_DIR/scripts/solid-diagnostics-physical-proof.mjs" \
      "$DIAGNOSTICS_PATH" "$SNAPSHOT_PATH"
  then
    correlated=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

if [ "$correlated" != true ]; then
  echo "The iOS app did not retain a correlated Solid-to-native frame chain within 20 bounded captures." >&2
  exit 1
fi

node "$REPO_ROOT/packages/cli/dist/bin.js" debug report-ios \
  "$BUNDLE_IDENTIFIER" --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --duration 1200 --timeout 10000 --output "$REPORT_PATH"
node "$APP_DIR/scripts/solid-diagnostics-physical-proof.mjs" \
  --report "$REPORT_PATH"
