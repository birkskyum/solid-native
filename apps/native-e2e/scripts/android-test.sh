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
source_map="$script_dir/../android/app/build/generated/sourcemaps/react/solidRelease/index.android.bundle.map"
application_bundle="$script_dir/../android/app/build/generated/assets/react/solidRelease/index.android.bundle"
application_apk="$script_dir/../android/app/build/outputs/apk/solid/release/app-solid-release.apk"
instrumentation_apk="$script_dir/../android/app/build/outputs/apk/androidTest/solid/release/app-solid-release-androidTest.apk"
instrumentation_results="$script_dir/../android/app/build/outputs/androidTest-results/connected/release/flavors/solid"
proof_directory="$script_dir/../build/device-proofs"
source_policy_report="$proof_directory/android-solid-release-source-policy.json"
if [ -n "${SOLID_NATIVE_ANDROID_PROOF_RECEIPT:-}" ]; then
  receipt_path=$SOLID_NATIVE_ANDROID_PROOF_RECEIPT
else
  receipt_path="$proof_directory/android-solid-release.json"
  # The package-owned producer never overwrites evidence. Only the runner's
  # documented ignored scratch receipt is cleared between local proof runs.
  rm -f "$receipt_path"
fi
trap 'solid_native_android_restore_stay_awake "$serial"' EXIT HUP INT TERM

# Release preparation can outlast a short display timeout. Android may classify
# an adb-tethered power source as AC or USB, so lease both wired stay-awake bits
# and restore the exact prior setting on every exit path. Collapse stale system
# UI and fail before the build if a secure keyguard still requires the user.
solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical renderer proof"

ANDROID_SERIAL=$serial
export ANDROID_SERIAL
mkdir -p "$proof_directory"
sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidRelease \
  :app:assembleSolidReleaseAndroidTest
node "$script_dir/../../../packages/cli/dist/bin.js" bundle sources \
  "$source_map" \
  --cwd "$script_dir/.." \
  --require "app:///apps/native-e2e/adapters/NotifeeApiModule.ts" \
  --require "app:///apps/native-e2e/generated/SolidNativeBindings.ts" \
  --require "app:///packages/notifications/dist/notify-kit-10.js" \
  --forbid-containing "/node_modules/react-native-notify-kit/" \
  --json >"$source_policy_report"
# Reassert foreground readiness immediately before instrumentation; native
# preparation can be long enough for external device state to change.
solid_native_android_prepare_device "$serial" "physical renderer proof"
proof_started_at=$(node -e 'process.stdout.write(new Date().toISOString())')
sh "$script_dir/android-gradle.sh" \
  :app:connectedSolidReleaseAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.class=dev.solidnative.e2e.SolidNativePhysicalTest#testPhysicalRendererUpdate"
node "$script_dir/verify-solid-runtime-sourcemap.mjs" "$source_map"
node "$script_dir/../../../packages/cli/dist/bin.js" device-proof create-android \
  --cwd "$script_dir/.." \
  --serial "$serial" \
  --not-before "$proof_started_at" \
  --bundle "$application_bundle" \
  --source-map "$source_map" \
  --apk "$application_apk" \
  --instrumentation-apk "$instrumentation_apk" \
  --bindings "$script_dir/../generated/SolidNativeBindings.ts" \
  --instrumentation-results "$instrumentation_results" \
  --instrumentation-class "dev.solidnative.e2e.SolidNativePhysicalTest" \
  --instrumentation-test "testPhysicalRendererUpdate" \
  --require "app:///apps/native-e2e/adapters/NotifeeApiModule.ts" \
  --require "app:///apps/native-e2e/generated/SolidNativeBindings.ts" \
  --require "app:///packages/notifications/dist/notify-kit-10.js" \
  --forbid-containing "/node_modules/react-native-notify-kit/" \
  --output "$receipt_path"

trap - EXIT HUP INT TERM
solid_native_android_restore_stay_awake "$serial"
