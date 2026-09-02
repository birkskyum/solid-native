#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_RELOAD_DERIVED_DATA:-"$IOS_DIR/build/device-reload"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID:-dev.solidnative.reload}
METRO_PORT=${SOLID_NATIVE_IOS_RELOAD_METRO_PORT:-8092}
RELOAD_MODE=${SOLID_NATIVE_IOS_RELOAD_MODE:-metro}
UNLOCK_WAIT_SECONDS=${SOLID_NATIVE_IOS_RELOAD_UNLOCK_WAIT_SECONDS:-300}
INSTALLED=0

cleanup() {
  stop_solid_native_ios_process_guard
  if [ "$INSTALLED" -eq 1 ]; then
    xcrun devicectl device uninstall app \
      --device "$SOLID_NATIVE_IOS_DESTINATION" \
      --quiet \
      "$BUNDLE_IDENTIFIER" >/dev/null 2>&1 || true
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
    echo "SOLID_NATIVE_IOS_RELOAD_UNLOCK_WAIT_SECONDS must be an integer from 1 through 600." >&2
    exit 1
    ;;
esac
if [ "$UNLOCK_WAIT_SECONDS" -lt 1 ] || [ "$UNLOCK_WAIT_SECONDS" -gt 600 ]; then
  echo "SOLID_NATIVE_IOS_RELOAD_UNLOCK_WAIT_SECONDS must be an integer from 1 through 600." >&2
  exit 1
fi
case "$RELOAD_MODE" in
  metro|bundled) ;;
  *)
    echo "SOLID_NATIVE_IOS_RELOAD_MODE must be either metro or bundled." >&2
    exit 1
    ;;
esac

node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-device-preflight.mjs" "$SOLID_NATIVE_IOS_DESTINATION" --wait-seconds "$UNLOCK_WAIT_SECONDS"
node "$APP_DIR/scripts/ios-host-preflight.mjs"
pnpm --dir "$REPO_ROOT" --filter '@solid-native/native-e2e...' build
ensure_solid_native_ios_pods

METRO_HOST=${SOLID_NATIVE_IOS_RELOAD_METRO_HOST:-}
if [ "$RELOAD_MODE" = metro ] && [ -z "$METRO_HOST" ]; then
  PRIMARY_INTERFACE=$(route -n get default 2>/dev/null | awk '$1 == "interface:" { print $2; exit }')
  if [ -n "$PRIMARY_INTERFACE" ]; then
    METRO_HOST=$(ipconfig getifaddr "$PRIMARY_INTERFACE" 2>/dev/null || true)
  fi
fi
if [ "$RELOAD_MODE" = metro ]; then
  case "$METRO_HOST" in
    ''|*[!A-Za-z0-9.-]*)
      echo "Could not resolve the Mac's active IPv4 address for the iOS Metro server. Set SOLID_NATIVE_IOS_RELOAD_METRO_HOST explicitly." >&2
      exit 1
      ;;
  esac
  set -- SKIP_BUNDLING=1 build-for-testing
else
  set -- ENTRY_FILE=dev-entry.tsx FORCE_BUNDLING=1 build-for-testing
fi
xcodebuild \
  -quiet \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Debug \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOLID_NATIVE_RELOAD_METRO_LOCATION="$METRO_HOST:$METRO_PORT" \
  -allowProvisioningUpdates \
  "$@"

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug-iphoneos/SolidNativeE2E.app"
DEVICE_DETAILS_PATH="$DERIVED_DATA_PATH/reload-device.json"
rm -f "$DEVICE_DETAILS_PATH"
xcrun devicectl device info details \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --json-output "$DEVICE_DETAILS_PATH" \
  --quiet
TRACE_DEVICE=$(plutil -extract result.hardwareProperties.udid raw "$DEVICE_DETAILS_PATH")
DEVICE_MODEL=$(plutil -extract result.hardwareProperties.marketingName raw "$DEVICE_DETAILS_PATH")
OS_VERSION=$(plutil -extract result.deviceProperties.osVersionNumber raw "$DEVICE_DETAILS_PATH")
node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
# A cold signed build can outlast the phone's Auto-Lock interval. Recheck the
# mutable device and host state at the last safe boundary instead of letting
# XCTest wait two minutes for an unavailable UI-automation destination.
node "$APP_DIR/scripts/ios-device-preflight.mjs" \
  "$SOLID_NATIVE_IOS_DESTINATION" \
  --wait-seconds "$UNLOCK_WAIT_SECONDS"
node "$APP_DIR/scripts/ios-host-preflight.mjs"
xcrun devicectl device install app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  "$APP_PATH"
INSTALLED=1
start_solid_native_ios_process_guard

SOLID_NATIVE_IOS_RELOAD_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
SOLID_NATIVE_IOS_RELOAD_DEVICE_MODEL="$DEVICE_MODEL" \
SOLID_NATIVE_IOS_RELOAD_DERIVED_DATA="$DERIVED_DATA_PATH" \
SOLID_NATIVE_IOS_RELOAD_METRO_HOST="$METRO_HOST" \
SOLID_NATIVE_IOS_RELOAD_METRO_PORT="$METRO_PORT" \
SOLID_NATIVE_IOS_RELOAD_MODE="$RELOAD_MODE" \
SOLID_NATIVE_IOS_RELOAD_OS_VERSION="$OS_VERSION" \
SOLID_NATIVE_IOS_RELOAD_TRACE_DEVICE="$TRACE_DEVICE" \
  node "$APP_DIR/scripts/ios-reload-soak.mjs"
