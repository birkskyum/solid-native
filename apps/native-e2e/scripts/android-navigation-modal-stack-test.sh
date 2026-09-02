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
app_apk="$android_dir/app/build/outputs/apk/solidNavigation/release/app-solidNavigation-release.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solidNavigation/release/app-solidNavigation-release-androidTest.apk"
app_id=dev.solidnative.navigation
test_id=dev.solidnative.navigation.test
test_class=dev.solidnative.e2e.SolidNativeModalStackPhysicalTest#testNestedModalStackOnPhysicalDevice
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

finish_cleanup() {
  adb -s "$serial" shell am force-stop "$app_id"
  if adb -s "$serial" shell pidof "$app_id" >/dev/null 2>&1; then
    echo "The nested modal-stack app remained alive after force-stop." >&2
    exit 1
  fi
  adb -s "$serial" uninstall "$test_id"
  adb -s "$serial" uninstall "$app_id"
  if [ -n "$(adb -s "$serial" shell pm path "$test_id" 2>/dev/null)" ] || \
     [ -n "$(adb -s "$serial" shell pm path "$app_id" 2>/dev/null)" ]; then
    echo "A disposable nested modal-stack package remained installed." >&2
    exit 1
  fi
}

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical modal-stack proof"
ENTRY_FILE=navigation-modal-stack.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidNavigationRelease \
  :app:assembleSolidNavigationReleaseAndroidTest
solid_native_android_prepare_device "$serial" "physical modal-stack proof"
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical modal-stack proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The physical nested modal-stack instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

marker_attempt=0
while :; do
  logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
  if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_NAVIGATION_MODAL_STACK_FAILED" >/dev/null; then
    echo "The nested modal-stack proof emitted a JavaScript failure marker." >&2
    exit 1
  fi
  missing_marker=
  for marker in \
    SOLID_NATIVE_NAVIGATION_MODAL_STACK_READY \
    SOLID_NATIVE_NAVIGATION_MODAL_STACK_LEVEL_SUCCEEDED \
    SOLID_NATIVE_NAVIGATION_MODAL_STACK_PLATFORM_SUCCEEDED \
    SOLID_NATIVE_NAVIGATION_MODAL_STACK_APPLICATION_SUCCEEDED \
    SOLID_NATIVE_NAVIGATION_MODAL_STACK_TEARDOWN_SUCCEEDED
  do
    if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
      missing_marker=$marker
      break
    fi
  done
  if [ -z "$missing_marker" ]; then
    break
  fi
  marker_attempt=$((marker_attempt + 1))
  if [ "$marker_attempt" -ge 150 ]; then
    echo "Missing nested modal-stack proof marker after teardown wait: $missing_marker" >&2
    exit 1
  fi
  sleep 0.1
done

pid=$(printf '%s\n' "$logs" | awk \
  '/SOLID_NATIVE_NAVIGATION_MODAL_STACK_READY/ { print $3; exit }')
case "$pid" in
  ''|*[!0-9]*)
    echo "The nested modal-stack ready marker did not expose a valid process ID." >&2
    exit 1
    ;;
esac
finish_cleanup
echo "Verified two-level Solid-owned native Modal routing, platform Back, serialized application multi-pop, and exact teardown on $serial (process $pid)."
