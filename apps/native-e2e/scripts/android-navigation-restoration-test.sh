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
test_class=dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

stop_phase_process() {
  phase=$1
  adb -s "$serial" shell am force-stop "$app_id"
  if adb -s "$serial" shell pidof "$app_id" >/dev/null 2>&1; then
    echo "The navigation-process $phase app remained alive after force-stop." >&2
    exit 1
  fi
}

finish_cleanup() {
  stop_phase_process final
  adb -s "$serial" uninstall "$test_id"
  adb -s "$serial" uninstall "$app_id"
  if [ -n "$(adb -s "$serial" shell pm path "$test_id" 2>/dev/null)" ] || \
     [ -n "$(adb -s "$serial" shell pm path "$app_id" 2>/dev/null)" ]; then
    echo "A disposable navigation-process package remained installed." >&2
    exit 1
  fi
}

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical navigation proof"
ENTRY_FILE=navigation-restoration.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidNavigationRelease \
  :app:assembleSolidNavigationReleaseAndroidTest
node "$script_dir/../../../packages/cli/dist/bin.js" bundle sources \
  "$android_dir/app/build/generated/sourcemaps/react/solidNavigationRelease/index.android.bundle.map" \
  --cwd "$script_dir/.." \
  --require "app:///apps/native-e2e/adapters/RNAsyncStorage.ts" \
  --require "app:///apps/native-e2e/generated/SolidNativeBindings.ts" \
  --require "app:///packages/storage/dist/async-storage-3.js" \
  --forbid-containing "/node_modules/@react-native-async-storage/async-storage/"
source_map="$android_dir/app/build/generated/sourcemaps/react/solidNavigationRelease/index.android.bundle.map"
node "$script_dir/verify-solid-runtime-sourcemap.mjs" "$source_map"
node "$script_dir/verify-navigation-sourcemap.mjs" \
  "$source_map" navigation-restoration.tsx
solid_native_android_prepare_device "$serial" "physical navigation proof"
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"

last_phase_pid=
run_phase() {
  phase=$1
  shift
  first_marker=$1
  solid_native_android_prepare_device "$serial" "physical navigation proof"
  adb -s "$serial" logcat -c
  result=$(adb -s "$serial" shell am instrument -w -r \
    -e class "$test_class" \
    -e solidNativeNavigationProcessPhase "$phase" \
    "$runner")
  printf '%s\n' "$result"
  case "$result" in
    *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
    *)
      echo "The navigation-process $phase instrumentation phase did not pass exactly one test." >&2
      exit 1
      ;;
  esac

  marker_attempt=0
  while :; do
    logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
    if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_NAVIGATION_PROCESS_FAILED" >/dev/null; then
      echo "The navigation-process $phase phase emitted a JavaScript failure marker." >&2
      exit 1
    fi
    missing_marker=
    for marker in "$@"; do
      if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
        missing_marker=$marker
        break
      fi
    done
    if [ -z "$missing_marker" ]; then
      break
    fi
    marker_attempt=$((marker_attempt + 1))
    if [ "$marker_attempt" -ge 100 ]; then
      echo "Missing navigation-process $phase marker after teardown wait: $missing_marker" >&2
      exit 1
    fi
    sleep 0.1
  done
  last_phase_pid=$(printf '%s\n' "$logs" | awk -v marker="$first_marker" \
    'index($0, marker) { print $3; exit }')
  case "$last_phase_pid" in
    ''|*[!0-9]*)
      echo "The navigation-process $phase marker did not expose a valid process ID." >&2
      exit 1
      ;;
  esac
}

run_phase seed \
  SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_SEED_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_SHEET_DETENT_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED
seed_pid=$last_phase_pid
stop_phase_process seed

run_phase restore \
  SOLID_NATIVE_NAVIGATION_PROCESS_RESTORATION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_ACTION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BLOCKED_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_BLOCKER_RELEASED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BACK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED
restore_pid=$last_phase_pid
if [ "$seed_pid" = "$restore_pid" ]; then
  echo "Navigation restoration reused the seeded process ID $seed_pid." >&2
  exit 1
fi
stop_phase_process restore

run_phase pressure \
  SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_CAPTURE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_PRESSURE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_RECOVERY_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_RESTORATION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BACK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED
pressure_pid=$last_phase_pid
if [ "$pressure_pid" = "$seed_pid" ] || [ "$pressure_pid" = "$restore_pid" ]; then
  echo "The navigation memory-pressure proof reused an earlier process ID $pressure_pid." >&2
  exit 1
fi
stop_phase_process pressure

run_phase churn \
  SOLID_NATIVE_NAVIGATION_PROCESS_CHURN_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED
churn_pid=$last_phase_pid
if [ "$churn_pid" = "$seed_pid" ] || [ "$churn_pid" = "$restore_pid" ] || [ "$churn_pid" = "$pressure_pid" ]; then
  echo "The navigation churn proof reused an earlier process ID $churn_pid." >&2
  exit 1
fi
stop_phase_process churn

run_phase product \
  SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_SLOW_LOADER_STARTED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_INTERRUPTION_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BACK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED
product_pid=$last_phase_pid
if [ "$product_pid" = "$seed_pid" ] || [ "$product_pid" = "$restore_pid" ] || [ "$product_pid" = "$pressure_pid" ] || [ "$product_pid" = "$churn_pid" ]; then
  echo "The authenticated product proof reused an earlier process ID $product_pid." >&2
  exit 1
fi
stop_phase_process product

run_phase cold \
  SOLID_NATIVE_NAVIGATION_PROCESS_DISCARDED_STORAGE_CLEARED \
  SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED
cold_pid=$last_phase_pid
if [ "$cold_pid" = "$seed_pid" ] || [ "$cold_pid" = "$restore_pid" ] || [ "$cold_pid" = "$pressure_pid" ] || [ "$cold_pid" = "$churn_pid" ] || [ "$cold_pid" = "$product_pid" ]; then
  echo "The navigation cold-link proof reused an earlier process ID $cold_pid." >&2
  exit 1
fi

finish_cleanup
echo "Verified single-stack navigation and durable scroll restoration ($seed_pid -> $restore_pid), memory-pressure reclamation/recovery ($pressure_pid), 30-cycle native churn ($churn_pid), authenticated interruption ($product_pid), cold-link precedence ($cold_pid), and balanced focus-task lifecycles in all six fresh processes on $serial."
