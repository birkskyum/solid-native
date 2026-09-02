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
apk="$android_dir/app/build/outputs/apk/solid/release/app-solid-release.apk"

cleanup() {
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "Release application launch"
sh "$script_dir/android-gradle.sh" :app:assembleSolidRelease
solid_native_android_prepare_device "$serial" "Release application launch"
adb -s "$serial" install -r "$apk"
adb -s "$serial" shell am start -S -W \
  -n dev.solidnative.e2e/.MainActivity
