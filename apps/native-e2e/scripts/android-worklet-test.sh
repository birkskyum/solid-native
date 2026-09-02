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
android_dir="$script_dir/../android"
app_apk="$android_dir/app/build/outputs/apk/solidWorklet/release/app-solidWorklet-release.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solidWorklet/release/app-solidWorklet-release-androidTest.apk"
app_id=dev.solidnative.worklet
test_id=dev.solidnative.worklet.test
test_class=dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical UI-worklet proof"
ENTRY_FILE=worklet.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidWorkletRelease \
  :app:assembleSolidWorkletReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical UI-worklet proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The native UI worklet instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_UI_WORKLET_FAILED" >/dev/null; then
  echo "The native UI worklet run emitted its JavaScript failure marker." >&2
  exit 1
fi
for marker in \
  SOLID_NATIVE_PRODUCT_ANIMATION_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_DECODER_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_CONFORMANCE_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_INITIAL_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_UPDATE_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_TIMING_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_CANCELLATION_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_KEYFRAMES_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_SPRING_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_DECAY_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_PAN_ATTACHED \
  SOLID_NATIVE_UI_WORKLET_PAN_DETACHED \
  SOLID_NATIVE_UI_WORKLET_PAN_SUCCEEDED \
  SOLID_NATIVE_UI_WORKLET_TEARDOWN_SUCCEEDED
do
  if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
    echo "The native UI worklet run omitted marker $marker." >&2
    exit 1
  fi
done

stability_json=$(printf '%s\n' "$logs" | node "$script_dir/parse-worklet-stability.mjs")
printf 'Native UI worklet stability: %s\n' "$stability_json"
echo "Verified the product animation ref, native graph decoding, synchronous driver cancellation, sustained Choreographer view output, bounded keyframe sequencing, analytical spring and decay drivers, reversible UI-thread pan ownership, and teardown on $serial."
