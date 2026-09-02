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

cleanup() {
  adb -s "$serial" shell am force-stop dev.solidnative.e2e >/dev/null 2>&1 || true
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "ordinary launch proof"
adb -s "$serial" logcat -c
SOLID_NATIVE_ANDROID_SERIAL=$serial sh "$script_dir/android-release.sh"

attempt=1
while [ "$attempt" -le 100 ]; do
  logs=$(adb -s "$serial" logcat -d -v brief ReactNativeJS:I '*:S')
  if printf '%s\n' "$logs" | grep -Fq 'SOLID_NATIVE_E2E_FAILED'; then
    printf '%s\n' "$logs" >&2
    echo "The ordinary Android launch reported a JavaScript proof failure." >&2
    exit 1
  fi
  if printf '%s\n' "$logs" | grep -Fq 'SOLID_NATIVE_INITIAL_FOCUS_SUCCEEDED' &&
    printf '%s\n' "$logs" | grep -Fq 'SOLID_NATIVE_GENERATED_TURBOMODULE_SCHEMA_SUCCEEDED' &&
    printf '%s\n' "$logs" | grep -Fq 'SOLID_NATIVE_QUIESCENT_READY'
  then
    echo "Android ordinary launch loaded generated TurboModule schema, mounted, measured, synchronized native focus, and stayed quiescent."
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

printf '%s\n' "$logs" >&2
echo "The ordinary Android launch did not reach quiescent readiness within ten seconds." >&2
exit 1
