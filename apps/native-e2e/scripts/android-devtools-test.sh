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
repo_root=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
app_dir="$script_dir/.."
android_dir="$script_dir/../android"
app_apk="$android_dir/app/build/outputs/apk/solidDevtools/debug/app-solidDevtools-debug.apk"
test_apk="$android_dir/app/build/outputs/apk/androidTest/solidDevtools/release/app-solidDevtools-release-androidTest.apk"
source_map="$app_dir/build/devtools/index.android.bundle.map"
metro_log="$app_dir/build/devtools/metro.log"
app_id=dev.solidnative.e2e
test_id=dev.solidnative.e2e.test
test_class=dev.solidnative.e2e.SolidNativeDevtoolsPhysicalTest#testDevelopmentErrorOverlayRecoveryOnPhysicalDevice
runner="$test_id/androidx.test.runner.AndroidJUnitRunner"
device_metro_port=8081
host_metro_port=8093
metro_pid=

cleanup() {
  adb -s "$serial" reverse --remove "tcp:$device_metro_port" >/dev/null 2>&1 || true
  adb -s "$serial" shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$test_id" >/dev/null 2>&1 || true
  adb -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
  if [ -n "$metro_pid" ] && kill -0 "$metro_pid" >/dev/null 2>&1; then
    kill "$metro_pid" >/dev/null 2>&1 || true
    metro_stop_attempt=1
    while kill -0 "$metro_pid" >/dev/null 2>&1 && [ "$metro_stop_attempt" -le 50 ]
    do
      sleep 0.1
      metro_stop_attempt=$((metro_stop_attempt + 1))
    done
    if kill -0 "$metro_pid" >/dev/null 2>&1; then
      kill -9 "$metro_pid" >/dev/null 2>&1 || true
    fi
    wait "$metro_pid" >/dev/null 2>&1 || true
  fi
  solid_native_android_restore_stay_awake "$serial"
}
trap cleanup EXIT HUP INT TERM

solid_native_android_lease_stay_awake "$serial"
solid_native_android_prepare_device "$serial" "physical development-overlay proof"
pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
sh "$script_dir/android-gradle.sh" \
  :app:assembleSolidDevtoolsDebug \
  :app:assembleSolidDevtoolsReleaseAndroidTest
mkdir -p "$(dirname -- "$source_map")"
node "$repo_root/packages/cli/dist/bin.js" start \
  --cwd "$app_dir" -- --port "$host_metro_port" >"$metro_log" 2>&1 &
metro_pid=$!
metro_deadline=$(( $(date +%s) + 30 ))
until curl --fail --silent "http://127.0.0.1:$host_metro_port/status" \
  | grep -F "packager-status:running" >/dev/null
do
  if ! kill -0 "$metro_pid" >/dev/null 2>&1; then
    echo "The Solid Native Metro server exited before the devtools proof started." >&2
    tail -n 80 "$metro_log" >&2 || true
    exit 1
  fi
  if [ "$(date +%s)" -ge "$metro_deadline" ]; then
    echo "The Solid Native Metro server did not become ready for the devtools proof." >&2
    tail -n 80 "$metro_log" >&2 || true
    exit 1
  fi
  sleep 1
done
adb -s "$serial" reverse \
  "tcp:$device_metro_port" "tcp:$host_metro_port"
adb -s "$serial" install -r "$app_apk"
adb -s "$serial" install -r "$test_apk"
solid_native_android_prepare_device "$serial" "physical development-overlay proof"
adb -s "$serial" logcat -c

result=$(adb -s "$serial" shell am instrument -w -r \
  -e class "$test_class" \
  "$runner")
printf '%s\n' "$result"
case "$result" in
  *"OK (1 test)"*"INSTRUMENTATION_CODE: -1"*) ;;
  *)
    echo "The Android development-overlay instrumentation did not pass exactly one test." >&2
    exit 1
    ;;
esac

required_markers="
  SOLID_NATIVE_DEVTOOLS_READY
  SOLID_NATIVE_DEVTOOLS_CAUSAL_SEEDED
  SOLID_NATIVE_DEVTOOLS_ASYNC_REPORTED
  SOLID_NATIVE_DEVTOOLS_ASYNC_RECOVERED
  SOLID_NATIVE_DEVTOOLS_RUNTIME_REPORTED
  SOLID_NATIVE_DEVTOOLS_RUNTIME_RECOVERED
  SOLID_NATIVE_DEVTOOLS_RENDER_RECOVERED
  SOLID_NATIVE_DEVTOOLS_BRIDGE_REMOVED
  SOLID_NATIVE_DEVTOOLS_TEARDOWN_SUCCEEDED
"
marker_deadline=$(( $(date +%s) + 30 ))
while :
do
  logs=$(adb -s "$serial" logcat -d -v threadtime ReactNativeJS:I '*:S')
  if printf '%s\n' "$logs" | grep -F "SOLID_NATIVE_DEVTOOLS_FAILED" >/dev/null; then
    echo "The Android development-overlay proof emitted its JavaScript failure marker." >&2
    exit 1
  fi
  missing_marker=
  for marker in $required_markers
  do
    if ! printf '%s\n' "$logs" | grep -F "$marker" >/dev/null; then
      missing_marker=$marker
      break
    fi
  done
  if [ -z "$missing_marker" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$marker_deadline" ]; then
    echo "The Android development-overlay proof omitted marker $missing_marker." >&2
    exit 1
  fi
  sleep 1
done

curl --fail --silent --show-error \
  "http://127.0.0.1:$host_metro_port/devtools.map?platform=android&dev=true&minify=false" \
  --output "$source_map"

adb -s "$serial" shell am force-stop "$app_id"
for package_name in "$test_id" "$app_id"
do
  uninstall_result=$(adb -s "$serial" uninstall "$package_name")
  if [ "$uninstall_result" != "Success" ]; then
    echo "Android development-overlay proof could not remove $package_name: $uninstall_result" >&2
    exit 1
  fi
done
if adb -s "$serial" shell pidof "$app_id" | grep -E '[0-9]' >/dev/null; then
  echo "The Android development-overlay app process survived verified cleanup." >&2
  exit 1
fi
for package_name in "$test_id" "$app_id"
do
  if adb -s "$serial" shell pm path "$package_name" 2>/dev/null | grep -F 'package:' >/dev/null; then
    echo "Android development-overlay package $package_name survived verified cleanup." >&2
    exit 1
  fi
done

echo "Verified repeated network and causal panel ownership, causal grouping, on-device Solid/native correlation, and explicit, guarded-runtime, and Solid render-error recovery through native development UI, bridge restoration, and non-terminating teardown on $serial."
