#!/bin/sh
set -eu

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is required; install Android platform-tools and put adb on PATH." >&2
  exit 1
fi

variant=${1:-}
case "$variant" in
  solid)
    bundle_identifier=dev.solidnative.memory
    gradle_variant=SolidMemoryRelease
    apk_variant=solidMemory
    entry_file=memory.tsx
    react_control=0
    ;;
  control)
    bundle_identifier=dev.solidnative.memory.control
    gradle_variant=ReactMemoryControlRelease
    apk_variant=reactMemoryControl
    entry_file=memory-control.ts
    react_control=1
    ;;
  *)
    echo "Usage: android-memory-install.sh solid|control" >&2
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

if [ "$react_control" -eq 1 ]; then
  ENTRY_FILE="$entry_file" SOLID_NATIVE_REACT_CONTROL=1 \
    sh "$script_dir/android-gradle.sh" ":app:assemble$gradle_variant"
else
  ENTRY_FILE="$entry_file" \
    sh "$script_dir/android-gradle.sh" ":app:assemble$gradle_variant"
fi
adb -s "$serial" install -r "$apk"
echo "Installed $bundle_identifier for matched memory sampling."
