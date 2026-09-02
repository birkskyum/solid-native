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
if [ "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')" = "1" ]; then
  echo "The measured-list proof requires physical Android hardware." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/android-device-preflight.sh"
android_dir="$script_dir/../android"
app_apk="$android_dir/app/build/outputs/apk/solidList/release/app-solidList-release.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solidList/release/app-solidList-release-androidTest.apk"
app_id=dev.solidnative.list
test_id=dev.solidnative.list.test
test_class=dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalMeasuredVirtualizedList
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" shell am force-stop "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical intrinsic-height list proof"
ENTRY_FILE=list-measured.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidListRelease \
  :app:assembleSolidListReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical intrinsic-height list proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The Android measured-list instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

logs=$(adb -s "$serial" logcat -d -v threadtime)
if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_FAILED" >/dev/null; then
  echo "The Android measured-list proof emitted its JavaScript failure marker." >&2
  exit 1
fi
for marker in \
  SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_READY \
  SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_SUCCEEDED \
  SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_NATIVE_SUCCEEDED \
  SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_RECYCLING_SUCCEEDED
do
  if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
    echo "The Android measured-list proof omitted marker $marker." >&2
    exit 1
  fi
done

adb -s "$serial" shell am force-stop "$app_id"
adb -s "$serial" shell am force-stop "$test_id" >/dev/null 2>&1 || true
for package_name in "$test_id" "$app_id"
do
  uninstall_result=$(adb -s "$serial" uninstall "$package_name")
  if [ "$uninstall_result" != "Success" ]; then
    echo "Android measured-list proof could not remove $package_name: $uninstall_result" >&2
    exit 1
  fi
done
for package_name in "$test_id" "$app_id"
do
  if adb -s "$serial" shell pidof "$package_name" | grep -E '[0-9]' >/dev/null; then
    echo "Android measured-list process $package_name survived verified cleanup." >&2
    exit 1
  fi
  if adb -s "$serial" shell pm path "$package_name" 2>/dev/null | grep -F 'package:' >/dev/null; then
    echo "Android measured-list package $package_name survived verified cleanup." >&2
    exit 1
  fi
done

echo "Verified physical Android intrinsic-height geometry, bounded post-swipe ownership, proof markers, and cleanup on $serial."
