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
  echo "The accessibility proof requires physical Android hardware." >&2
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
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"
test_class=dev.solidnative.e2e.SolidNativeAccessibilityPhysicalTest#testPreferenceDeliveryAnnouncementAndOwnerTeardownOnPhysicalDevice

original_transition_scale=$(adb -s "$serial" shell settings get global transition_animation_scale | tr -d '\r')
original_high_contrast=$(adb -s "$serial" shell settings get secure high_text_contrast_enabled | tr -d '\r')

restore_setting() {
  namespace=$1
  key=$2
  value=$3
  if [ "$value" = "null" ] || [ -z "$value" ]; then
    adb -s "$serial" shell settings delete "$namespace" "$key" >/dev/null
  else
    adb -s "$serial" shell settings put "$namespace" "$key" "$value" >/dev/null
  fi
}

restore_device_settings() {
  restore_setting global transition_animation_scale "$original_transition_scale"
  restore_setting secure high_text_contrast_enabled "$original_high_contrast"
}

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  restore_device_settings >/dev/null 2>&1 || true
  adb -s "$serial" shell am force-stop "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical accessibility proof"
pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
ENTRY_FILE=accessibility.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidRelease \
  :app:assembleSolidReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"

solid_native_android_prepare_device "$serial" "physical accessibility proof"
adb -s "$serial" logcat -c
result=$(adb -s "$serial" shell am instrument -w -r \
  -e original_transition_scale "$original_transition_scale" \
  -e original_high_contrast "$original_high_contrast" \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The Android accessibility instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_ACCESSIBILITY_FAILED" >/dev/null; then
  echo "The Android accessibility proof emitted its JavaScript failure marker." >&2
  exit 1
fi
for marker in \
  SOLID_NATIVE_ACCESSIBILITY_READY \
  SOLID_NATIVE_ACCESSIBILITY_TIMEOUT_READY \
  SOLID_NATIVE_ACCESSIBILITY_PREFERENCE_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_ACCESSIBILITY_REFRESHED \
  SOLID_NATIVE_ACCESSIBILITY_ANNOUNCED \
  SOLID_NATIVE_ACCESSIBILITY_TEARDOWN_SUCCEEDED
do
  if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
    echo "The Android accessibility proof omitted marker $marker." >&2
    exit 1
  fi
done
causal_count=$(printf '%s\n' "$logs" | grep -c -F "SOLID_NATIVE_ACCESSIBILITY_PREFERENCE_CAUSALITY_SUCCEEDED")
if [ "$causal_count" -ne 4 ]; then
  echo "The Android accessibility proof produced $causal_count causal preference commits instead of 4." >&2
  exit 1
fi

adb -s "$serial" shell am force-stop "$app_id"
restore_device_settings
for setting_spec in \
  "global transition_animation_scale $original_transition_scale" \
  "secure high_text_contrast_enabled $original_high_contrast"
do
  set -- $setting_spec
  restored=$(adb -s "$serial" shell settings get "$1" "$2" | tr -d '\r')
  if [ "$restored" != "$3" ]; then
    echo "Android accessibility proof did not restore $1 setting $2." >&2
    exit 1
  fi
done
adb -s "$serial" shell am force-stop "$test_id" >/dev/null 2>&1 || true
for package_name in "$test_id" "$app_id"
do
  uninstall_result=$(adb -s "$serial" uninstall "$package_name")
  if [ "$uninstall_result" != "Success" ]; then
    echo "Android accessibility proof could not remove $package_name: $uninstall_result" >&2
    exit 1
  fi
done
for package_name in "$test_id" "$app_id"
do
  if adb -s "$serial" shell pidof "$package_name" | grep -E '[0-9]' >/dev/null; then
    echo "Android accessibility process $package_name survived verified cleanup." >&2
    exit 1
  fi
  if adb -s "$serial" shell pm path "$package_name" 2>/dev/null | grep -F 'package:' >/dev/null; then
    echo "Android accessibility package $package_name survived verified cleanup." >&2
    exit 1
  fi
done

echo "Verified Android preference delivery, four causal Fabric commits, native announcement capture, setting restoration, and non-terminating teardown on $serial."
