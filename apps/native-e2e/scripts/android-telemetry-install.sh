#!/bin/sh
set -eu

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is required; install Android platform-tools and put adb on PATH." >&2
  exit 1
fi

variant=${1:-}
case "$variant" in
  baseline)
    bundle_identifier=dev.solidnative.telemetry.baseline
    gradle_variant=SolidTelemetryBaselineRelease
    apk_variant=solidTelemetryBaseline
    entry_file=telemetry-baseline.ts
    ;;
  observed)
    bundle_identifier=dev.solidnative.telemetry.observed
    gradle_variant=SolidTelemetryObservedRelease
    apk_variant=solidTelemetryObserved
    entry_file=telemetry-observed.ts
    ;;
  *)
    echo "Usage: android-telemetry-install.sh baseline|observed" >&2
    exit 1
    ;;
esac

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
android_dir="$script_dir/../android"
apk="$android_dir/app/build/outputs/apk/$apk_variant/release/app-$apk_variant-release.apk"

ENTRY_FILE="$entry_file" \
  sh "$script_dir/android-gradle.sh" ":app:assemble$gradle_variant"
adb -s "$serial" install -r "$apk"
echo "Installed $bundle_identifier for causal telemetry benchmarking."
