#!/bin/sh

SOLID_NATIVE_IOS_PROCESS_GUARD_PID=

start_solid_native_ios_process_guard() {
  if [ -n "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID" ]; then
    echo "The iOS process cleanup watchdog is already running." >&2
    return 1
  fi
  timeout_seconds=${SOLID_NATIVE_IOS_PROCESS_GUARD_TIMEOUT_SECONDS:-1200}
  case "$timeout_seconds" in
    ''|*[!0-9]*|0*)
      echo "SOLID_NATIVE_IOS_PROCESS_GUARD_TIMEOUT_SECONDS must be a positive integer." >&2
      return 1
      ;;
  esac
  if [ "${#timeout_seconds}" -gt 4 ] || [ "$timeout_seconds" -gt 3600 ]; then
    echo "SOLID_NATIVE_IOS_PROCESS_GUARD_TIMEOUT_SECONDS cannot exceed 3600." >&2
    return 1
  fi
  timeout_milliseconds=$((timeout_seconds * 1000))
  SOLID_NATIVE_IOS_PROCESS_GUARD_PID=$( \
    node "$APP_DIR/scripts/ios-stop-processes.mjs" \
      --spawn-watchdog "$$" "$timeout_milliseconds" "$SOLID_NATIVE_IOS_DESTINATION" \
  )
}

stop_solid_native_ios_process_guard() {
  if [ -z "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID" ]; then
    return
  fi

  if ! node "$APP_DIR/scripts/ios-stop-processes.mjs" \
    "$SOLID_NATIVE_IOS_DESTINATION" >/dev/null 2>&1; then
    echo "Immediate iOS process cleanup failed; the detached watchdog will retry after this runner exits." >&2
    return 0
  fi

  kill "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID" >/dev/null 2>&1 || true
  wait "$SOLID_NATIVE_IOS_PROCESS_GUARD_PID" 2>/dev/null || true
  SOLID_NATIVE_IOS_PROCESS_GUARD_PID=
}
