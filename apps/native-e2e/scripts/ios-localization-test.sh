#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
. "$APP_DIR/scripts/ios-pods-ensure.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
IOS_DIR="$APP_DIR/ios"
DERIVED_DATA_PATH=${SOLID_NATIVE_IOS_LOCALIZATION_DERIVED_DATA:-"$IOS_DIR/build/device-localization-tests"}
BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_LOCALIZATION_BUNDLE_ID:-dev.solidnative.localization}
SOURCE_MAP_PATH="$DERIVED_DATA_PATH/localization.ios.bundle.map"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2E.app"
TEST_BUNDLE_PATH="$DERIVED_DATA_PATH/Build/Products/Release-iphoneos/SolidNativeE2EUITests-Runner.app/PlugIns/SolidNativeE2EUITests.xctest"
RESULTS_DIRECTORY="$DERIVED_DATA_PATH/Logs/Test"
RESULT_BUNDLE_PATH="$RESULTS_DIRECTORY/SolidNativeLocalization-$(date +%Y%m%d-%H%M%S).xcresult"
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
  ENTRY_FILE=localization.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeLocalizationStartupSnapshotsAndPhysicalLayoutOnPhysicalDevice \
  clean build-for-testing

node "$APP_DIR/scripts/verify-solid-runtime-sourcemap.mjs" "$SOURCE_MAP_PATH"
node "$APP_DIR/scripts/verify-localization-sourcemap.mjs" "$SOURCE_MAP_PATH"

if [ ! -d "$APP_PATH" ] || [ ! -d "$TEST_BUNDLE_PATH" ]; then
  echo "The signed iOS localization app or UI-test bundle is missing after build-for-testing." >&2
  exit 1
fi

ACTUAL_BUNDLE_IDENTIFIER=$(
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist"
)
if [ "$ACTUAL_BUNDLE_IDENTIFIER" != "$BUNDLE_IDENTIFIER" ]; then
  echo "Expected iOS app bundle identifier $BUNDLE_IDENTIFIER; found $ACTUAL_BUNDLE_IDENTIFIER." >&2
  exit 1
fi
for localization in en ar
do
  if ! /usr/libexec/PlistBuddy -c 'Print :CFBundleLocalizations' "$APP_PATH/Info.plist" | \
    grep -F "$localization" >/dev/null; then
    echo "The signed iOS localization app does not declare $localization." >&2
    exit 1
  fi
done

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
  ENTRY_FILE=localization.tsx \
  SOLID_NATIVE_APP_BUNDLE_ID="$BUNDLE_IDENTIFIER" \
  SOURCEMAP_FILE="$SOURCE_MAP_PATH" \
  -allowProvisioningUpdates \
  -collect-test-diagnostics never \
  -resultBundlePath "$RESULT_BUNDLE_PATH" \
  -only-testing:SolidNativeE2EUITests/SolidNativeE2EUITests/testNativeLocalizationStartupSnapshotsAndPhysicalLayoutOnPhysicalDevice \
  test-without-building
XCODEBUILD_STATUS=$?
set -e
if [ "$XCODEBUILD_STATUS" -ne 0 ]; then
  node "$APP_DIR/scripts/ios-xctest-failure-hint.mjs" "$RESULT_BUNDLE_PATH" || true
  exit "$XCODEBUILD_STATUS"
fi

DIAGNOSTICS_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-localization-test.XXXXXX")
DIAGNOSTICS_DIRECTORY="$DIAGNOSTICS_PARENT/diagnostics"
xcrun xcresulttool export diagnostics \
  --path "$RESULT_BUNDLE_PATH" \
  --output-path "$DIAGNOSTICS_DIRECTORY"

if grep -R -F -q "SOLID_NATIVE_LOCALIZATION_FAILED" "$DIAGNOSTICS_DIRECTORY"; then
  echo "The iOS localization proof emitted its JavaScript failure marker." >&2
  exit 1
fi

for marker in \
  SOLID_NATIVE_LOCALIZATION_READY \
  SOLID_NATIVE_LOCALIZATION_TEARDOWN_SUCCEEDED
do
  marker_count=$(grep -R -F -h "$marker" "$DIAGNOSTICS_DIRECTORY" | wc -l | tr -d ' ')
  if [ "$marker_count" -lt 2 ]; then
    echo "The two iOS localization cold starts emitted only $marker_count instances of $marker." >&2
    exit 1
  fi
done
for snapshot in \
  "'SOLID_NATIVE_LOCALIZATION_READY', 'en-US', 'ltr', true" \
  "'SOLID_NATIVE_LOCALIZATION_READY', 'ar-SA', 'rtl', true"
do
  if ! grep -R -F -q "$snapshot" "$DIAGNOSTICS_DIRECTORY"; then
    echo "Missing exact iOS localization startup evidence: $snapshot" >&2
    exit 1
  fi
done

stop_solid_native_ios_process_guard
xcrun devicectl device uninstall app \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --quiet \
  "$BUNDLE_IDENTIFIER"
INSTALL_ATTEMPTED=0

echo "Verified process-scoped en-US/LTR and ar-SA/RTL iPhone startup snapshots, mirrored Fabric geometry, and non-terminating teardown on $SOLID_NATIVE_IOS_DESTINATION."
