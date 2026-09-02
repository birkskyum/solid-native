#!/bin/sh

# Shared physical-device readiness helpers. This file is sourced by runners and
# deliberately does not change shell options or install traps on its own.

solid_native_android_lease_stay_awake() {
  solid_native_android_serial=$1
  if [ "${solid_native_android_stay_awake_leased:-0}" = "1" ]; then
    return 0
  fi
  solid_native_android_previous_stay_awake=$(
    adb -s "$solid_native_android_serial" shell settings get global stay_on_while_plugged_in | tr -d '\r'
  )
  adb -s "$solid_native_android_serial" shell settings put global stay_on_while_plugged_in 3 >/dev/null
  solid_native_android_stay_awake_leased=1
}

solid_native_android_restore_stay_awake() {
  solid_native_android_serial=$1
  if [ "${solid_native_android_stay_awake_leased:-0}" != "1" ]; then
    return 0
  fi
  if [ -z "${solid_native_android_previous_stay_awake:-}" ] || \
     [ "$solid_native_android_previous_stay_awake" = "null" ]; then
    if ! adb -s "$solid_native_android_serial" shell settings delete global stay_on_while_plugged_in >/dev/null; then
      echo "Warning: could not restore Android stay-awake state on $solid_native_android_serial." >&2
    fi
  elif ! adb -s "$solid_native_android_serial" shell settings put global stay_on_while_plugged_in "$solid_native_android_previous_stay_awake" >/dev/null; then
    echo "Warning: could not restore Android stay-awake state on $solid_native_android_serial." >&2
  fi
  solid_native_android_stay_awake_leased=0
}

solid_native_android_prepare_device() {
  solid_native_android_serial=$1
  solid_native_android_proof_name=$2
  adb -s "$solid_native_android_serial" shell input keyevent KEYCODE_WAKEUP >/dev/null
  adb -s "$solid_native_android_serial" shell wm dismiss-keyguard >/dev/null
  adb -s "$solid_native_android_serial" shell cmd statusbar collapse >/dev/null 2>&1 || true
  sleep "${SOLID_NATIVE_ANDROID_DEVICE_SETTLE_SECONDS:-1}"
  solid_native_android_keyguard_showing=$(
    adb -s "$solid_native_android_serial" shell dumpsys window policy | tr -d '\r' | awk '
      /KeyguardServiceDelegate/ { in_delegate = 1; next }
      in_delegate && $1 ~ /^showing=/ {
        sub(/^showing=/, "", $1)
        print $1
        exit
      }
    '
  )
  if [ "$solid_native_android_keyguard_showing" != "false" ]; then
    echo "Android device $solid_native_android_serial is locked; unlock it before running the $solid_native_android_proof_name." >&2
    return 1
  fi
}
