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
  echo "The selected Android device is unavailable or not authorized." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/android-device-preflight.sh"
android_dir="$script_dir/../android"
app_apk="$android_dir/app/build/outputs/apk/solidTelemetryObserved/release/app-solidTelemetryObserved-release.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solidTelemetryObserved/release/app-solidTelemetryObserved-release-androidTest.apk"
source_map="$android_dir/app/build/generated/sourcemaps/react/solidTelemetryObservedRelease/index.android.bundle.map"
app_id=dev.solidnative.telemetry.observed
test_id=dev.solidnative.telemetry.observed.test
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
solid_native_android_prepare_device "$serial" "physical product-telemetry proof"
ENTRY_FILE=product-workload-observed.ts sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidTelemetryObservedRelease \
  :app:assembleSolidTelemetryObservedReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r -t "$test_apk"
solid_native_android_prepare_device "$serial" "physical product-telemetry proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The product telemetry instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

attempt=0
while :; do
  logs=$(adb -s "$serial" logcat -d -v brief SOLID_NATIVE:I ReactNativeJS:I '*:S')
  if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_PRODUCT_WORKLOAD_FAILED" >/dev/null; then
    echo "The product telemetry run emitted its JavaScript failure marker." >&2
    exit 1
  fi
  if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_PRODUCT_TELEMETRY_RESULT" >/dev/null; then
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    echo "The product telemetry result did not settle after instrumentation." >&2
    exit 1
  fi
  sleep 0.1
done

proof=$(printf '%s\n' "$logs" | node "$script_dir/parse-product-telemetry-proof.mjs")
printf 'Product causal proof: %s\n' "$proof"
node "$script_dir/verify-solid-runtime-sourcemap.mjs" "$source_map"

adb -s "$serial" shell am force-stop "$app_id"
if adb -s "$serial" shell pidof "$app_id" >/dev/null 2>&1; then
  echo "The product telemetry process remained alive after force-stop." >&2
  exit 1
fi
adb -s "$serial" uninstall "$test_id"
adb -s "$serial" uninstall "$app_id"
if [ -n "$(adb -s "$serial" shell pm path "$test_id" 2>/dev/null)" ] || \
   [ -n "$(adb -s "$serial" shell pm path "$app_id" 2>/dev/null)" ]; then
  echo "A disposable product telemetry package remained installed." >&2
  exit 1
fi
solid_native_android_restore_stay_awake "$serial"
trap - EXIT HUP INT TERM

echo "Verified 30 physical dashboard interactions across Solid causal ownership and native mount/frame boundaries."
