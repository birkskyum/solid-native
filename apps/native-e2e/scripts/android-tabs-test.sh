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
app_apk="$android_dir/app/build/outputs/apk/solidTabs/release/app-solidTabs-release.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solidTabs/release/app-solidTabs-release-androidTest.apk"
app_id=dev.solidnative.tabs
test_id=dev.solidnative.tabs.test
test_class=dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate
appearance_test_class=dev.solidnative.e2e.SolidNativeTabsAppearancePhysicalTest#testNativeTabsAppearanceCrossesFabric
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

# The four Release phases can outlast the display timeout. Keep the tethered
# Pixel awake for this proof, restore the prior setting on exit, and fail before
# building when a secure keyguard still requires the user.
solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical native-tabs proof"

ENTRY_FILE=tabs.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidTabsRelease \
  :app:assembleSolidTabsReleaseAndroidTest
source_map="$android_dir/app/build/generated/sourcemaps/react/solidTabsRelease/index.android.bundle.map"
node "$script_dir/verify-solid-runtime-sourcemap.mjs" "$source_map"
node "$script_dir/verify-navigation-sourcemap.mjs" \
  "$source_map" tabs.tsx
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"

last_phase_pid=
run_phase() {
  phase=$1
  shift
  first_marker=$1
  solid_native_android_prepare_device "$serial" "physical native-tabs proof"
  adb -s "$serial" logcat -c
  result=$(adb -s "$serial" shell am instrument -w -r \
    -e class "$test_class" \
    -e solidNativeTabsPhase "$phase" \
    "$runner")
  printf '%s\n' "$result"
  case "$result" in
    *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
    *)
      echo "The native-tabs $phase instrumentation phase did not pass exactly one test." >&2
      exit 1
      ;;
  esac

  marker_attempt=0
  while :; do
    logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
    if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_TABS_FAILED" >/dev/null; then
      echo "The native-tabs $phase phase emitted a JavaScript failure marker." >&2
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
      echo "Missing native-tabs $phase proof marker after teardown wait: $missing_marker" >&2
      exit 1
    fi
    sleep 0.1
  done
  last_phase_pid=$(printf '%s\n' "$logs" | awk -v marker="$first_marker" \
    'index($0, marker) { print $3; exit }')
  case "$last_phase_pid" in
    ''|*[!0-9]*)
      echo "The native-tabs $phase marker did not expose a valid process ID." >&2
      exit 1
      ;;
  esac
}

run_phase seed \
  SOLID_NATIVE_TABS_PROCESS_SEED_SUCCEEDED \
  SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED
seed_pid=$last_phase_pid
adb -s "$serial" shell am force-stop "$app_id"
if adb -s "$serial" shell pidof "$app_id" >/dev/null 2>&1; then
  echo "The seeded native-tabs process remained alive after force-stop." >&2
  exit 1
fi

run_phase restore \
  SOLID_NATIVE_TABS_PROCESS_RESTORATION_SUCCEEDED \
  SOLID_NATIVE_TABS_PLATFORM_BACK_SUCCEEDED \
  SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED
restore_pid=$last_phase_pid
if [ "$seed_pid" = "$restore_pid" ]; then
  echo "The native-tabs restoration reused the seeded process ID $seed_pid." >&2
  exit 1
fi
adb -s "$serial" shell am force-stop "$app_id"

run_phase product \
  SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_STORED \
  SOLID_NATIVE_TABS_PRODUCT_COMPOSITION_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_LINK_CAUSALITY_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED \
  SOLID_NATIVE_TABS_PLATFORM_BACK_SUCCEEDED \
  SOLID_NATIVE_TABS_SELECTION_SUCCEEDED \
  SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED
product_pid=$last_phase_pid
if [ "$product_pid" = "$seed_pid" ] || [ "$product_pid" = "$restore_pid" ]; then
  echo "The product-composition proof reused an earlier process ID $product_pid." >&2
  exit 1
fi
adb -s "$serial" shell am force-stop "$app_id"

run_phase product-restore \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORED \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORE_SUCCEEDED \
  SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED \
  SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED
product_restore_pid=$last_phase_pid
if [ "$product_restore_pid" = "$seed_pid" ] || [ "$product_restore_pid" = "$restore_pid" ] || [ "$product_restore_pid" = "$product_pid" ]; then
  echo "The secure-session restoration proof reused an earlier process ID $product_restore_pid." >&2
  exit 1
fi
adb -s "$serial" shell am force-stop "$app_id"

run_phase cold \
  SOLID_NATIVE_TABS_DISCARDED_STORAGE_CLEARED \
  SOLID_NATIVE_TABS_PERSISTENCE_SUCCEEDED \
  SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED
cold_pid=$last_phase_pid
if [ "$cold_pid" = "$seed_pid" ] || [ "$cold_pid" = "$restore_pid" ] || [ "$cold_pid" = "$product_pid" ] || [ "$cold_pid" = "$product_restore_pid" ]; then
  echo "The cold-link proof reused an earlier process ID $cold_pid." >&2
  exit 1
fi

adb -s "$serial" shell am force-stop "$app_id"
solid_native_android_prepare_device "$serial" "physical native-tabs proof"
adb -s "$serial" logcat -c
appearance_result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$appearance_test_class" \
  "$runner")
printf '%s\n' "$appearance_result"
case "$appearance_result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The native-tabs appearance instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac
appearance_logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
if printf '%s\n' "$appearance_logs" | grep -F "SOLID_NATIVE_TABS_FAILED" >/dev/null; then
  echo "The native-tabs appearance phase emitted a JavaScript failure marker." >&2
  exit 1
fi
if ! printf '%s\n' "$appearance_logs" | grep -F \
  "SOLID_NATIVE_TABS_ICON_OWNERSHIP_SUCCEEDED" >/dev/null; then
  echo "The native-tabs appearance phase did not finish its icon-ownership sequence." >&2
  exit 1
fi

echo "Verified native-tabs process restoration ($seed_pid -> $restore_pid), tabs/stack/sheet product composition ($product_pid), Keystore session restoration ($product_restore_pid), cold-link precedence ($cold_pid), Material appearance transport, and deterministic image ownership on $serial."
