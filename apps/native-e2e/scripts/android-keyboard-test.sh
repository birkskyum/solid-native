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
profile=${SOLID_NATIVE_ANDROID_KEYBOARD_PROFILE:-avoidance}
case "$profile" in
  avoidance)
    entry_file=keyboard.tsx
    test_method=testSoftwareKeyboardAvoidanceOnPhysicalDevice
    failure_marker=SOLID_NATIVE_KEYBOARD_FAILED
    required_markers="
      SOLID_NATIVE_KEYBOARD_READY
      SOLID_NATIVE_KEYBOARD_LAYOUT_OBSERVED
      SOLID_NATIVE_KEYBOARD_METRICS_OBSERVED
      SOLID_NATIVE_KEYBOARD_AVOIDANCE_APPLIED
      SOLID_NATIVE_KEYBOARD_VISIBLE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_AVOIDANCE_CLEARED
      SOLID_NATIVE_KEYBOARD_AVOIDANCE_CAUSALITY_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_STATE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_TEARDOWN_SUCCEEDED
    "
    success_description="Android software-keyboard visibility, measured avoidance, frame restoration, causal privacy, submission, blur, and teardown"
    ;;
  focused-scroll)
    entry_file=keyboard-scroll.tsx
    test_method=testFocusedFieldScrollOnPhysicalDevice
    failure_marker=SOLID_NATIVE_KEYBOARD_SCROLL_FAILED
    required_markers="
      SOLID_NATIVE_KEYBOARD_SCROLL_READY
      SOLID_NATIVE_KEYBOARD_SCROLL_METRICS_OBSERVED
      SOLID_NATIVE_KEYBOARD_FOCUS_VISIBILITY_APPLIED
      SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SCROLL_APPLIED
      SOLID_NATIVE_KEYBOARD_NATIVE_SCROLL_OBSERVED
      SOLID_NATIVE_KEYBOARD_SCROLL_VISIBLE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_STATE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_SCROLL_CAUSALITY_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_SCROLL_STATE_SUCCEEDED
      SOLID_NATIVE_KEYBOARD_SCROLL_TEARDOWN_SUCCEEDED
    "
    success_description="Android focused-field measurement, automatic native scrolling, Next/Done focus traversal, keyboard clearance, causal privacy, submission, blur, and teardown"
    ;;
  *)
    echo "Unknown Android keyboard proof profile: $profile" >&2
    exit 2
    ;;
esac
test_class=dev.solidnative.e2e.SolidNativeKeyboardPhysicalTest#$test_method
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical keyboard proof"
pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
ENTRY_FILE="$entry_file" sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidRelease \
  :app:assembleSolidReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical keyboard proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The Android keyboard avoidance instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

marker_deadline=$(( $(date +%s) + 10 ))
while :
do
  logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
  if printf '%s\n' "$logs" | grep -F "$failure_marker" >/dev/null; then
    echo "The Android $profile keyboard proof emitted its JavaScript failure marker." >&2
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
    echo "The Android $profile keyboard proof omitted marker $missing_marker after its teardown deadline." >&2
    exit 1
  fi
  sleep 0.1
done

echo "Verified $success_description on $serial."
