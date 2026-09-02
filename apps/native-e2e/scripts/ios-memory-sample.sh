#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$APP_DIR/scripts/ios-process-guard.sh"
REPO_ROOT=$(CDPATH= cd -- "$APP_DIR/../.." && pwd)
VARIANT=${1:-}
DURATION_SECONDS=${SOLID_NATIVE_IOS_MEMORY_DURATION:-60}
SETTLE_SECONDS=${SOLID_NATIVE_IOS_MEMORY_SETTLE:-5}

: "${SOLID_NATIVE_IOS_DESTINATION:?Set SOLID_NATIVE_IOS_DESTINATION to the connected CoreDevice identifier.}"

case "$VARIANT" in
  solid)
    BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_MEMORY_BUNDLE_ID:-dev.solidnative.memory}
    ;;
  control)
    BUNDLE_IDENTIFIER=${SOLID_NATIVE_IOS_MEMORY_CONTROL_BUNDLE_ID:-dev.solidnative.memory.control}
    ;;
  *)
    echo "Usage: ios-memory-sample.sh solid|control" >&2
    exit 1
    ;;
esac

case "$DURATION_SECONDS" in
  ''|*[!0-9]*)
    echo "SOLID_NATIVE_IOS_MEMORY_DURATION must be an integer of at least 10 seconds." >&2
    exit 1
    ;;
esac
case "$SETTLE_SECONDS" in
  ''|*[!0-9]*)
    echo "SOLID_NATIVE_IOS_MEMORY_SETTLE must be a non-negative integer." >&2
    exit 1
    ;;
esac
if [ "$DURATION_SECONDS" -lt 10 ]; then
  echo "SOLID_NATIVE_IOS_MEMORY_DURATION must be an integer of at least 10 seconds." >&2
  exit 1
fi

NATIVE_COMPATIBILITY_IDENTITY=$(node "$APP_DIR/scripts/native-benchmark-environment.mjs" "$REPO_ROOT" "$APP_DIR" ios)
set -- $NATIVE_COMPATIBILITY_IDENTITY
if [ "$#" -ne 2 ]; then
  echo "Native compatibility identity did not contain exactly two fields." >&2
  exit 1
fi
NATIVE_COMPATIBILITY_FINGERPRINT=$1
NATIVE_COMPATIBILITY_INPUT_COUNT=$2

if [ -n "${SOLID_NATIVE_IOS_MEMORY_OUTPUT_DIR:-}" ]; then
  OUTPUT_DIRECTORY="$SOLID_NATIVE_IOS_MEMORY_OUTPUT_DIR/$VARIANT-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$OUTPUT_DIRECTORY"
  KEEP_OUTPUT=1
else
  OUTPUT_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/solid-native-ios-memory.XXXXXX")
  KEEP_OUTPUT=0
fi

cleanup() {
  stop_solid_native_ios_process_guard
  if [ "$KEEP_OUTPUT" -eq 0 ]; then
    rm -rf "$OUTPUT_DIRECTORY"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

node "$APP_DIR/scripts/ios-stop-processes.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-device-preflight.mjs" "$SOLID_NATIVE_IOS_DESTINATION"
node "$APP_DIR/scripts/ios-host-preflight.mjs"

xcrun devicectl device info details \
  --device "$SOLID_NATIVE_IOS_DESTINATION" \
  --json-output "$OUTPUT_DIRECTORY/device.json" \
  --quiet
TRACE_DEVICE=$(plutil -extract result.hardwareProperties.udid raw "$OUTPUT_DIRECTORY/device.json")
DEVICE_MODEL=$(plutil -extract result.hardwareProperties.marketingName raw "$OUTPUT_DIRECTORY/device.json")
OS_VERSION=$(plutil -extract result.deviceProperties.osVersionNumber raw "$OUTPUT_DIRECTORY/device.json")

start_solid_native_ios_process_guard
RECORD_ATTEMPT=1
TRACE_PATH=
while [ "$RECORD_ATTEMPT" -le 3 ]; do
  LAUNCH_PATH="$OUTPUT_DIRECTORY/launch-$RECORD_ATTEMPT.json"
  xcrun devicectl device process launch \
    --device "$SOLID_NATIVE_IOS_DESTINATION" \
    --terminate-existing \
    --json-output "$LAUNCH_PATH" \
    "$BUNDLE_IDENTIFIER" \
    --solid-native-memory-keep-awake
  PROCESS_IDENTIFIER=$(plutil -extract result.process.processIdentifier raw "$LAUNCH_PATH")
  sleep "$SETTLE_SECONDS"
  CANDIDATE_TRACE_PATH="$OUTPUT_DIRECTORY/activity-$RECORD_ATTEMPT.trace"
  if xcrun xctrace record \
    --template "Activity Monitor" \
    --device "$TRACE_DEVICE" \
    --attach "$PROCESS_IDENTIFIER" \
    --time-limit "${DURATION_SECONDS}s" \
    --output "$CANDIDATE_TRACE_PATH"
  then
    TRACE_PATH="$CANDIDATE_TRACE_PATH"
    break
  fi
  echo "xctrace record attempt $RECORD_ATTEMPT failed; relaunching." >&2
  RECORD_ATTEMPT=$((RECORD_ATTEMPT + 1))
  sleep 1
done
if [ -z "$TRACE_PATH" ]; then
  if [ "$KEEP_OUTPUT" -eq 0 ]; then
    KEEP_OUTPUT=1
    echo "Retained the failed recording artifacts at $OUTPUT_DIRECTORY" >&2
  fi
  echo "xctrace could not attach to the launched memory target." >&2
  exit 1
fi

EXPORT_ATTEMPT=1
SYSMON_PATH=
while [ "$EXPORT_ATTEMPT" -le 3 ]; do
  EXPORT_PATH="$OUTPUT_DIRECTORY/sysmon-$EXPORT_ATTEMPT.xml"
  if xcrun xctrace export \
    --input "$TRACE_PATH" \
    --xpath '/trace-toc/run[@number="1"]/data/table[@schema="sysmon-process"]' \
    --output "$EXPORT_PATH"
  then
    EXPORT_COMPLETED=1
  else
    EXPORT_COMPLETED=0
  fi
  if [ -s "$EXPORT_PATH" ] && \
    SOLID_NATIVE_IOS_MEMORY_VALIDATE_ONLY=1 \
      node "$APP_DIR/scripts/ios-memory-report.mjs" "$EXPORT_PATH" >/dev/null 2>&1
  then
    if [ "$EXPORT_COMPLETED" -eq 0 ]; then
      echo "xctrace export terminated after writing a valid Activity Monitor table; accepting the completed output." >&2
    fi
    SYSMON_PATH="$EXPORT_PATH"
    break
  fi
  echo "xctrace export attempt $EXPORT_ATTEMPT failed; retrying." >&2
  EXPORT_ATTEMPT=$((EXPORT_ATTEMPT + 1))
  sleep 1
done
if [ -z "$SYSMON_PATH" ]; then
  if [ "$KEEP_OUTPUT" -eq 0 ]; then
    KEEP_OUTPUT=1
    echo "Retained the failed trace at $OUTPUT_DIRECTORY" >&2
  fi
  echo "xctrace could not export the Activity Monitor process samples." >&2
  exit 1
fi

EXPORT_ATTEMPT=1
LIVE_PATH=
while [ "$EXPORT_ATTEMPT" -le 3 ]; do
  EXPORT_PATH="$OUTPUT_DIRECTORY/process-live-$EXPORT_ATTEMPT.xml"
  if xcrun xctrace export \
    --input "$TRACE_PATH" \
    --xpath '/trace-toc/run[@number="1"]/data/table[@schema="activity-monitor-process-live"]' \
    --output "$EXPORT_PATH"
  then
    EXPORT_COMPLETED=1
  else
    EXPORT_COMPLETED=0
  fi
  if [ -s "$EXPORT_PATH" ] && \
    SOLID_NATIVE_IOS_MEMORY_VALIDATE_LIVE_ONLY=1 \
      node "$APP_DIR/scripts/ios-memory-report.mjs" "$EXPORT_PATH" >/dev/null 2>&1
  then
    if [ "$EXPORT_COMPLETED" -eq 0 ]; then
      echo "xctrace export terminated after writing a valid Activity Monitor live table; accepting the completed output." >&2
    fi
    LIVE_PATH="$EXPORT_PATH"
    break
  fi
  echo "xctrace live export attempt $EXPORT_ATTEMPT failed; retrying." >&2
  EXPORT_ATTEMPT=$((EXPORT_ATTEMPT + 1))
  sleep 1
done
if [ -z "$LIVE_PATH" ]; then
  if [ "$KEEP_OUTPUT" -eq 0 ]; then
    KEEP_OUTPUT=1
    echo "Retained the failed trace at $OUTPUT_DIRECTORY" >&2
  fi
  echo "xctrace could not export the Activity Monitor live process intervals." >&2
  exit 1
fi

if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  DIRTY=true
else
  DIRTY=false
fi
REVISION=$(git -C "$REPO_ROOT" rev-parse HEAD)

SOLID_NATIVE_MEMORY_VARIANT="$VARIANT" \
SOLID_NATIVE_MEMORY_BUNDLE_IDENTIFIER="$BUNDLE_IDENTIFIER" \
SOLID_NATIVE_MEMORY_REQUESTED_DURATION="$DURATION_SECONDS" \
SOLID_NATIVE_MEMORY_REVISION="$REVISION" \
SOLID_NATIVE_MEMORY_DIRTY="$DIRTY" \
SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_FINGERPRINT="$NATIVE_COMPATIBILITY_FINGERPRINT" \
SOLID_NATIVE_MEMORY_NATIVE_COMPATIBILITY_INPUT_COUNT="$NATIVE_COMPATIBILITY_INPUT_COUNT" \
SOLID_NATIVE_MEMORY_DEVICE_MODEL="$DEVICE_MODEL" \
SOLID_NATIVE_MEMORY_OS_VERSION="$OS_VERSION" \
SOLID_NATIVE_IOS_MEMORY_RESULT_PATH="$OUTPUT_DIRECTORY/resource-result.json" \
  node "$APP_DIR/scripts/ios-memory-report.mjs" "$SYSMON_PATH" "$LIVE_PATH" || {
    if [ "$KEEP_OUTPUT" -eq 0 ]; then
      KEEP_OUTPUT=1
      echo "Retained the incomplete recording at $OUTPUT_DIRECTORY" >&2
    fi
    exit 1
  }

if [ "$KEEP_OUTPUT" -eq 1 ]; then
  echo "Retained raw iOS memory artifacts at $OUTPUT_DIRECTORY"
fi
