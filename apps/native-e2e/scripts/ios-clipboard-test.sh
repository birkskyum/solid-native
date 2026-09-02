#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_CLIPBOARD_DERIVED_DATA:-"$IOS_DIR/build/device-clipboard-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_CLIPBOARD_BUNDLE_ID:-dev.solidnative.clipboard}
SOURCE_DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_CLIPBOARD_SOURCE_DERIVED_DATA:-"$IOS_DIR/build/device-clipboard-source"}
SOURCE_BUNDLE_IDENTIFIER=dev.solidnative.clipboardsource
SOURCE_MAP_PATH="$DERIVED_DATA_PATH/clipboard.ios.bundle.map"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2E.app"
SOURCE_APP_PATH="$SOURCE_DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2E.app"
TEST_BUNDLE_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2EUITests-Runner.app/PlugIns/SolidNativeE2EUITests.xctest"
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeClipboard-$(date +%Y%m%d-%H%M%S).xcresult"
DIAGNOSTICS_PARENT=
INSTALL_ATTEMPTED=0
SOURCE_INSTALL_ATTEMPTED=0

restore_clipboard_source() {
  xcrun devicectl device process launch \
    --device "$SOLID_NATIVE_IOS_DESTINATION" \
    --terminate-existing \
    --no-activate \
    "$SOURCE_BUNDLE_IDENTIFIER" \
    --solid-native-clipboard-restore >/dev/null 2>&1
}

cleanup() {
  SOURCE_RESTORATION_SUCCEEDED=1
  if [ "$SOURCE_INSTALL_ATTEMPTED" -eq 1 ]; then
    if ! restore_clipboard_source; then
      SOURCE_RESTORATION_SUCCEEDED=0
      echo "Could not relaunch the clipboard source to restore its archived pasteboard; preserving the helper installation for recovery." >&2
    fi
  fi
  stop_solid_native_ios_process_guard
  if [ "$INSTALL_ATTEMPTED" -eq 1 ]; then
    xcrun devicectl device uninstall app \
      --device "$SOLID_NATIVE_IOS_DESTINATION" \
      --quiet \
      "$BUNDLE_IDENTIFIER" >/dev/null 2>&1 || true
  fi
  if [ "$SOURCE_INSTALL_ATTEMPTED" -eq 1 ] && [ "$SOURCE_RESTORATION_SUCCEEDED" -eq 1 ]; then
    xcrun devicectl device uninstall app \
      --device "$SOLID_NATIVE_IOS_DESTINATION" \
      --quiet \
      "$SOURCE_BUNDLE_IDENTIFIER" >/dev/null 2>&1 || true
  fi
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
  ENTRY_FILE=clipboard.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeClipboardBoundaryCausalityAndTeardownOnPhysicalDevice \
  clean build-for-testing

# Build the independent pasteboard source as a separately signed application.
# Its launch-argument path is native-only, so no JavaScript bundle is needed.
SKIP_BUNDLING=1 xcodebuild \
  -workspace "$IOS_DIR/SolidNativeE2E.xcworkspace" \
  -scheme SolidNativeE2E \
  -configuration Release \
  -destination "id=$SOLID_NATIVE_IOS_DESTINATION" \
  -derivedDataPath "$SOURCE_DERIVED_DATA_PATH" \
  DEVELOPMENT_TEAM="$SOLID_NATIVE_IOS_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  SOLID_NATIVE_APP_BUNDLE_ID="$SOURCE_BUNDLE_IDENTIFIER" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  build

node "$APP_DIR/scripts/verify-solid-runtime-sourcemap.mjs" "$SOURCE_MAP_PATH"
node "$APP_DIR/scripts/verify-clipboard-sourcemap.mjs" "$SOURCE_MAP_PATH"

if [ ! -d "$APP_PATH" ] || [ ! -d "$SOURCE_APP_PATH" ] || [ ! -d "$TEST_BUNDLE_PATH" ]; then
  echo "The signed iOS clipboard app, native source app, or UI-test bundle is missing after build." >&2
  exit 1
fi
if [ -e "$SOURCE_APP_PATH/main.jsbundle" ]; then
  echo "The native-only iOS clipboard source unexpectedly contains a JavaScript bundle." >&2
  exit 1
fi

ACTUAL_BUNDLE_IDENTIFIER=$(
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist"
)
if [ "$ACTUAL_BUNDLE_IDENTIFIER" != "$BUNDLE_IDENTIFIER" ]; then
  echo "Expected iOS app bundle identifier $BUNDLE_IDENTIFIER; found $ACTUAL_BUNDLE_IDENTIFIER." >&2
  exit 1
fi
ACTUAL_SOURCE_BUNDLE_IDENTIFIER=$(
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$SOURCE_APP_PATH/Info.plist"
)
if [ "$ACTUAL_SOURCE_BUNDLE_IDENTIFIER" != "$SOURCE_BUNDLE_IDENTIFIER" ]; then
  echo "Expected iOS clipboard source bundle identifier $SOURCE_BUNDLE_IDENTIFIER; found $ACTUAL_SOURCE_BUNDLE_IDENTIFIER." >&2
  exit 1
fi

/usr/bin/codesign --verify --deep --strict "$APP_PATH"
/usr/bin/codesign --verify --deep --strict "$SOURCE_APP_PATH"
/usr/bin/codesign --verify --deep --strict "$TEST_BUNDLE_PATH"

start_solid_native_ios_process_guard
# Upgrade any source helper retained after an interrupted older run, restore
# its persisted full pasteboard archive with the current binary, then reinstall
# a fresh helper before XCTest captures this run's clipboard.
xcrun devicectl device install app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --quiet \
  "$SOURCE_APP_PATH"
SOURCE_INSTALL_ATTEMPTED=1
restore_clipboard_source
node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION" >/dev/null
xcrun devicectl device uninstall app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --quiet \
  "$SOURCE_BUNDLE_IDENTIFIER"
xcrun devicectl device install app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --quiet \
  "$SOURCE_APP_PATH"
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
  ENTRY_FILE=clipboard.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeClipboardBoundaryCausalityAndTeardownOnPhysicalDevice \
  test-without-building
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-clipboard-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_CLIPBOARD_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS clipboard proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_CLIPBOARD_READY \
  SOLID_NATIVE_CLIPBOARD_WRITTEN \
  SOLID_NATIVE_CLIPBOARD_READ_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_CLIPBOARD_CLEARED \
  SOLID_NATIVE_CLIPBOARD_TEARDOWN_SUCCEEDED
do
  if ! grep -R -F -q "$marker" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing iOS clipboard physical-device proof marker: $marker" >&2
    exit 1
  fi
done

echo "Verified independent signed-app iPhone clipboard write/read/clear boundaries, privacy prompts, exact private causal commit, full original-value restoration, and non-terminating teardown on $SOLID_NATIVE_IOS_DESTINATION."
