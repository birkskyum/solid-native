#!/bin/sh

start_solid_native_ios_process_lease() {
  timeout_seconds=${SOLID_NATIVE_IOS_LAUNCH_LEASE_SECONDS:-1200}
  case "$timeout_seconds" in
    ''|*[!0-9]*|0*)
      echo "SOLID_NATIVE_IOS_LAUNCH_LEASE_SECONDS must be a positive integer." >&2
      return 1
      ;;
  esac
  if [ "${#timeout_seconds}" -gt 4 ] || [ "$timeout_seconds" -gt 3600 ]; then
    echo "SOLID_NATIVE_IOS_LAUNCH_LEASE_SECONDS cannot exceed 3600." >&2
    return 1
  fi
  timeout_milliseconds=$((timeout_seconds * 1000))
  if ! lease_watchdog_pid=$( \
    node "$APP_DIR/scripts/ios-stop-processes.mjs" \
      --spawn-lease "$timeout_milliseconds" "$SOLID_NATIVE_IOS_DESTINATION" \
  ); then
    node "$APP_DIR/scripts/ios-stop-processes.mjs" \
      "$SOLID_NATIVE_IOS_DESTINATION" >/dev/null 2>&1 || true
    echo "The iOS launch lease could not start; the app was stopped." >&2
    return 1
  fi
  echo "iOS process lease: PID $lease_watchdog_pid will stop this app after ${timeout_seconds}s."
}
