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
  echo "The platform-reactivity proof requires physical Android hardware." >&2
  exit 1
fi
read_night_mode() {
  status=$(adb -s "$serial" shell cmd uimode night | tr -d '\r')
  case "$status" in
    "Night mode: yes") printf '%s\n' yes ;;
    "Night mode: no") printf '%s\n' no ;;
    "Night mode: auto") printf '%s\n' auto ;;
    "Night mode: custom_schedule") printf '%s\n' custom_schedule ;;
    "Night mode: custom_bedtime") printf '%s\n' custom_bedtime ;;
    *)
      echo "Unsupported Android night-mode state: $status" >&2
      return 1
      ;;
  esac
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/android-device-preflight.sh"
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
android_dir="$script_dir/../android"
app_apk="$android_dir/app/build/outputs/apk/solid/release/app-solid-release.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solid/release/app-solid-release-androidTest.apk"
app_id=dev.solidnative.e2e
test_id=dev.solidnative.e2e.test
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"
test_class=dev.solidnative.e2e.SolidNativePlatformReactivityPhysicalTest#testOrientationAndSystemAppearanceReachSolidAndFabricOnPhysicalDevice
original_night_mode=$(read_night_mode)

restore_device_state() {
  adb -s "$serial" shell cmd uimode night "$original_night_mode" >/dev/null
}

cleanup() {
  restore_device_state >/dev/null 2>&1 || true
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" shell am force-stop "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical platform-reactivity proof"
pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
ENTRY_FILE=platform-reactivity.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidRelease \
  :app:assembleSolidReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"

solid_native_android_prepare_device "$serial" "physical platform-reactivity proof"
adb -s "$serial" logcat -c
result=$(adb -s "$serial" shell am instrument -w -r \
  -e original_night_mode "$original_night_mode" \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The Android platform-reactivity instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_PLATFORM_REACTIVITY_FAILED" >/dev/null; then
  echo "The Android platform-reactivity proof emitted its JavaScript failure marker." >&2
  exit 1
fi
for marker in \
  SOLID_NATIVE_PLATFORM_REACTIVITY_READY \
  SOLID_NATIVE_PLATFORM_WINDOW_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_PLATFORM_APPEARANCE_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_PLATFORM_REACTIVITY_TEARDOWN_SUCCEEDED
do
  if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
    echo "The Android platform-reactivity proof omitted marker $marker." >&2
    exit 1
  fi
done
window_count=$(printf '%s\n' "$logs" | grep -c -F "SOLID_NATIVE_PLATFORM_WINDOW_CAUSALITY_SUCCEEDED")
appearance_count=$(printf '%s\n' "$logs" | grep -c -F "SOLID_NATIVE_PLATFORM_APPEARANCE_CAUSALITY_SUCCEEDED")
if [ "$window_count" -ne 2 ] || [ "$appearance_count" -ne 2 ]; then
  echo "The Android platform-reactivity proof produced window=$window_count and appearance=$appearance_count causal commits instead of 2 each." >&2
  exit 1
fi

adb -s "$serial" shell am force-stop "$app_id"
restore_device_state
if [ "$(read_night_mode)" != "$original_night_mode" ]; then
  echo "The Android platform-reactivity proof did not restore the original night mode." >&2
  exit 1
fi
adb -s "$serial" shell am force-stop "$test_id" >/dev/null 2>&1 || true
for package_name in "$test_id" "$app_id"
do
  uninstall_result=$(adb -s "$serial" uninstall "$package_name")
  if [ "$uninstall_result" != "Success" ]; then
    echo "Android platform-reactivity proof could not remove $package_name: $uninstall_result" >&2
    exit 1
  fi
done
for package_name in "$test_id" "$app_id"
do
  if adb -s "$serial" shell pidof "$package_name" | grep -E '[0-9]' >/dev/null; then
    echo "Android platform-reactivity process $package_name survived verified cleanup." >&2
    exit 1
  fi
  if adb -s "$serial" shell pm path "$package_name" 2>/dev/null | grep -F 'package:' >/dev/null; then
    echo "Android platform-reactivity package $package_name survived verified cleanup." >&2
    exit 1
  fi
done

echo "Verified physical orientation and system-appearance delivery, four causal Fabric commits, state restoration, and non-terminating teardown on $serial."
