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
test_class=dev.solidnative.e2e.SolidNativeAlertPhysicalTest#testNativeAlertButtonAndDismissalOnPhysicalDevice
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical alert proof"
pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
ENTRY_FILE=alert.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidRelease \
  :app:assembleSolidReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical alert proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The Android alert instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

required_markers="
  SOLID_NATIVE_ALERT_READY
  SOLID_NATIVE_ALERT_BUTTON_CAUSALITY_SUCCEEDED
  SOLID_NATIVE_ALERT_DISMISS_CAUSALITY_SUCCEEDED
  SOLID_NATIVE_ALERT_TEARDOWN_SUCCEEDED
"
marker_deadline=$(( $(date +%s) + 30 ))
while :
do
  logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
  if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_ALERT_FAILED" >/dev/null; then
    echo "The Android alert proof emitted its JavaScript failure marker." >&2
    exit 1
  fi
  missing_marker=
  for marker in $required_markers
  do
    if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
      missing_marker=$marker
      break
    fi
  done
  if [ -z "$missing_marker" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$marker_deadline" ]; then
    echo "The Android alert proof omitted marker $missing_marker." >&2
    exit 1
  fi
  sleep 1
done

adb -s "$serial" shell am force-stop "$app_id"
for package_name in "$test_id" "$app_id"
do
  uninstall_result=$(adb -s "$serial" uninstall "$package_name")
  if [ "$uninstall_result" != "Success" ]; then
    echo "Android alert proof could not remove $package_name: $uninstall_result" >&2
    exit 1
  fi
done
if adb -s "$serial" shell pidof "$app_id" | grep -E '[0-9]' >/dev/null; then
  echo "The Android alert app process survived verified cleanup." >&2
  exit 1
fi
for package_name in "$test_id" "$app_id"
do
  if adb -s "$serial" shell pm path "$package_name" 2>/dev/null | grep -F 'package:' >/dev/null; then
    echo "Android alert package $package_name survived verified cleanup." >&2
    exit 1
  fi
done

echo "Verified native Android alert presentation, button identity, Back dismissal, causal commits, and non-terminating teardown on $serial."
