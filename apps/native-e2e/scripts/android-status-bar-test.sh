#!/bin/sh
set -eu

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is required; install Android platform-tools and put adb on PATH." >&2
  exit 1
fi

serial=${SOLID_NATIVE_ANDROID_SERIAL:-}
if [ -z "$serial" ]; then
  devices=$(adb devices | awk '$2 == "device" { print $1 }')
  device_count=$(printf '%s\n' "$devices" | awk 'NF { count++ } END { print count + 0 }')
  if [ "$device_count" -ne 1 ]; then
    echo "Expected exactly one authorized Android device; found $device_count." >&2
    echo "Set SOLID_NATIVE_ANDROID_SERIAL when more than one device is attached." >&2
    exit 1
  fi
  serial=$devices
fi

if [ "$(adb -s "$serial" get-state 2>/dev/null)" != "device" ]; then
  echo "Android device $serial is unavailable or not authorized." >&2
  exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/android-device-preflight.sh"
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
android_dir="$script_dir/../android"
app_apk="$android_dir/app/build/outputs/apk/solid/release/app-solid-release.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solid/release/app-solid-release-androidTest.apk"
app_id=dev.solidnative.e2e
test_id=dev.solidnative.e2e.test
test_class=dev.solidnative.e2e.SolidNativeStatusBarPhysicalTest#testStatusBarOwnerStackOnPhysicalDevice
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical status-bar proof"
pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
ENTRY_FILE=status-bar.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidRelease \
  :app:assembleSolidReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical status-bar proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The Android status-bar instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_STATUS_BAR_FAILED" >/dev/null; then
  echo "The Android status-bar proof emitted its JavaScript failure marker." >&2
  exit 1
fi
for marker in \
  SOLID_NATIVE_STATUS_BAR_READY \
  SOLID_NATIVE_STATUS_BAR_CHILD_MOUNTED \
  SOLID_NATIVE_STATUS_BAR_HIDDEN \
  SOLID_NATIVE_STATUS_BAR_PARENT_RESTORED \
  SOLID_NATIVE_STATUS_BAR_TEARDOWN_SUCCEEDED
do
  if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
    echo "The Android status-bar proof omitted marker $marker." >&2
    exit 1
  fi
done

echo "Verified native status-bar contrast, visibility, Solid owner restoration, and non-terminating teardown on $serial."
