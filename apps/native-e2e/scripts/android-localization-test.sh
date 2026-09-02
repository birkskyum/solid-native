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
  echo "The localization proof requires physical Android hardware." >&2
  exit 1
fi
if ! adb -s "$serial" shell cmd locale help 2>&1 | grep -F "set-app-localeconfig" >/dev/null; then
  echo "Android device $serial does not expose scoped application-locale configuration." >&2
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
test_class=dev.solidnative.e2e.SolidNativeLocalizationPhysicalTest

cleanup() {
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical localization proof"
pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
ENTRY_FILE=localization.tsx sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidRelease \
  :app:assembleSolidReleaseAndroidTest
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical localization proof"
adb -s "$serial" shell cmd locale set-app-localeconfig "$app_id" --locales en-US,ar-SA
locale_config=$(adb -s "$serial" shell cmd locale get-app-localeconfig "$app_id" | tr -d '\r')
case "$locale_config" in
  *en-US*ar-SA*) ;;
  *)
    echo "Android did not retain the proof app's scoped LTR/RTL locale config: $locale_config" >&2
    exit 1
    ;;
esac

run_locale_phase() {
  locale_tag=$1
  direction=$2
  test_method=$3
  solid_native_android_prepare_device "$serial" "physical localization proof"
  adb -s "$serial" shell am force-stop "$app_id"
  adb -s "$serial" shell cmd locale set-app-locales "$app_id" --locales "$locale_tag"
  app_locales=$(adb -s "$serial" shell cmd locale get-app-locales "$app_id" | tr -d '\r')
  case "$app_locales" in
    *"$locale_tag"*) ;;
    *)
      echo "Android did not apply scoped locale $locale_tag: $app_locales" >&2
      exit 1
      ;;
  esac
  adb -s "$serial" logcat -c
  result=$(adb -s "$serial" shell am instrument -w -r \
    -e class "$test_class#$test_method" \
    "$runner")
  printf '%s\n' "$result"
  case "$result" in
    *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
    *)
      echo "The Android $direction localization instrumentation did not pass exactly one test." >&2
      exit 1
      ;;
  esac
  logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
  if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_LOCALIZATION_FAILED" >/dev/null; then
    echo "The Android $direction localization proof emitted its JavaScript failure marker." >&2
    exit 1
  fi
  for marker in \
    SOLID_NATIVE_LOCALIZATION_READY \
    SOLID_NATIVE_LOCALIZATION_TEARDOWN_SUCCEEDED
  do
    if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
      echo "The Android $direction localization proof omitted marker $marker." >&2
      exit 1
    fi
  done
  if ! printf '%s\n' "$logs" | grep -F "$locale_tag" >/dev/null || \
     ! printf '%s\n' "$logs" | grep -F "$direction" >/dev/null; then
    echo "The Android localization log omitted exact $locale_tag/$direction startup evidence." >&2
    exit 1
  fi
}

run_locale_phase en-US ltr testLTRStartupSnapshotAndPhysicalLayout
run_locale_phase ar-SA rtl testRTLStartupSnapshotAndPhysicalLayout

adb -s "$serial" shell am force-stop "$app_id"
for package_name in "$test_id" "$app_id"
do
  uninstall_result=$(adb -s "$serial" uninstall "$package_name")
  if [ "$uninstall_result" != "Success" ]; then
    echo "Android localization proof could not remove $package_name: $uninstall_result" >&2
    exit 1
  fi
done
for package_name in "$test_id" "$app_id"
do
  if adb -s "$serial" shell pidof "$package_name" | grep -E '[0-9]' >/dev/null; then
    echo "Android localization process $package_name survived verified cleanup." >&2
    exit 1
  fi
  if adb -s "$serial" shell pm path "$package_name" 2>/dev/null | grep -F 'package:' >/dev/null; then
    echo "Android localization package $package_name survived verified cleanup." >&2
    exit 1
  fi
done

echo "Verified scoped en-US/LTR and ar-SA/RTL startup snapshots, mirrored Fabric geometry, and non-terminating teardown on $serial."
