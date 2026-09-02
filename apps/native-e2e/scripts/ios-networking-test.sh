#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_NETWORKING_DERIVED_DATA:-"$IOS_DIR/build/device-networking-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_NETWORKING_BUNDLE_ID:-dev.solidnative.networking}
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeNetworking-$(date +%Y%m%d-%H%M%S).xcresult"
SOURCE_MAP_PATH="$DERIVED_DATA_PATH/networking.ios.bundle.map"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2E.app"
TEST_BUNDLE_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2EUITests-Runner.app/PlugIns/SolidNativeE2EUITests.xctest"
DIAGNOSTICS_PARENT=
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
}

: "${SOLID_NATIVE_IOS_DESTINATION:?Set SOLID_NATIVE_IOS_DESTINATION to the connected device identifier shown by xcrun xctrace list devices.}"
: "${SOLID_NATIVE_IOS_TEAM:?Set SOLID_NATIVE_IOS_TEAM to the Apple Development team identifier selected in Xcode.}"
: "${SOLID_NATIVE_IOS_NETWORKING_ORIGIN:?The iOS networking orchestrator must provide its run-scoped local origin.}"
case "$SOLID_NATIVE_IOS_NETWORKING_ORIGIN" in
  http://*:*/*) ;;
  *)
    echo "The iOS networking origin is not a tokenized local HTTP endpoint." >&2
    exit 2
    ;;
esac
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-device-preflight.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-host-preflight.mjs"
xcrun devicectl device uninstall app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --quiet \
  "$BUNDLE_IDENTIFIER" >/dev/null 2>&1 || true
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
  ENTRY_FILE=networking.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOLID_NATIVE_NETWORKING_ORIGIN="$SOLID_NATIVE_IOS_NETWORKING_ORIGIN" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -only-testing:SolidNativeE2EUITests/SolidNativeNetworkingUITests/testNativeNetworkingProtocolsAndOwnerTeardownOnPhysicalDevice \
  clean build-for-testing

node "$APP_DIR/scripts/verify-solid-runtime-sourcemap.mjs" "$SOURCE_MAP_PATH"
node "$APP_DIR/scripts/verify-networking-sourcemap.mjs" "$SOURCE_MAP_PATH"

if [ ! -d "$APP_PATH" ] || [ ! -d "$TEST_BUNDLE_PATH" ]; then
  echo "The signed iOS networking app or UI-test bundle is missing after build-for-testing." >&2
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
INSTALL_ATTEMPTED=1
set +e
xcodebuild \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Release \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  ENTRY_FILE=networking.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOLID_NATIVE_NETWORKING_ORIGIN="$SOLID_NATIVE_IOS_NETWORKING_ORIGIN" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeNetworkingUITests/testNativeNetworkingProtocolsAndOwnerTeardownOnPhysicalDevice \
  test-without-building
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-networking-test.XXXXXX")
  DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
  if xcrun xcresulttool export diagnostics \
    --path "$RESULT_BUNDLE_PATH" \
    --output-path "$DIAGNOSTICS_DIRECTORY" >/dev/null 2>&1
  then
    ABI_DIAGNOSTICS=$(
      grep -R -a -h -o -E \
        'Native network completion (tuple must contain two or three elements; received [0-9]+|timeout flag has unsupported kind (array|bigint|boolean|function|number|object|string|symbol|undefined))\.' \
        "$DIAGNOSTICS_DIRECTORY" |
        sort -u || true
    )
    if [ -n "$ABI_DIAGNOSTICS" ]; then
      echo "Privacy-safe iOS Networking ABI diagnostic: $ABI_DIAGNOSTICS" >&2
    fi
  fi
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-networking-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_NETWORKING_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS native-networking proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_NETWORKING_READY \
  SOLID_NATIVE_NETWORKING_RESPONSE_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_CHUNK_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_SSE_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_JSON_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_JSON_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_FAILURE_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_CANCELLATION_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_PROTOCOL_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_DISPOSAL_ACTIVE \
  SOLID_NATIVE_NETWORKING_OWNER_CANCELLATION_SUCCEEDED \
  SOLID_NATIVE_NETWORKING_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS native-networking physical-device proof marker: $marker" >&2
    exit 1
  fi
done

PROCESS_COUNT=$(
  grep -R -a -h -o "SOLID_NATIVE_APP_PROCESS_ID_[0-9]*" "$DIAGNOSTICS_DIRECTORY" |
    sort -u |
    awk 'NF { count++ } END { print count + 0 }'
)
if [ "$PROCESS_COUNT" -ne 1 ]; then
  echo "Expected exactly one iOS native-networking app process; found $PROCESS_COUNT." >&2
  exit 1
fi

stop_solid_native_ios_process_guard
xcrun devicectl device uninstall app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --quiet \
  "$BUNDLE_IDENTIFIER"
INSTALL_ATTEMPTED=0

echo "Verified iPhone native networking protocols, causal frames, cancellation, privacy, and owner teardown on $SOLID_NATIVE_IOS_DESTINATION."
