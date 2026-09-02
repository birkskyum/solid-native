#!/bin/sh

solid_native_ios_pod_inputs_fingerprint() {
  shasum \
    "$IOS_DIR/Podfile" \
    "$REPO_ROOT/pnpm-lock.yaml" \
    "$APP_DIR/package.json" |
    shasum |
    awk '{print $1}'
}

ensure_solid_native_ios_pods() {
  podfile_checksum=$(shasum "$IOS_DIR/Podfile" | awk '{print $1}')
  input_fingerprint=$(solid_native_ios_pod_inputs_fingerprint)
  fingerprint_path="$IOS_DIR/Pods/.solid-native-input-fingerprint"

  if [ ! -f "$IOS_DIR/Pods/Manifest.lock" ] ||
    [ ! -f "$IOS_DIR/Pods/Pods.xcodeproj/project.pbxproj" ] ||
    ! grep -F -q "PODFILE CHECKSUM: $podfile_checksum" "$IOS_DIR/Podfile.lock" ||
    ! cmp -s "$IOS_DIR/Podfile.lock" "$IOS_DIR/Pods/Manifest.lock" ||
    [ ! -f "$fingerprint_path" ] ||
    [ "$(cat "$fingerprint_path" 2>/dev/null || true)" != "$input_fingerprint" ]
  then
    (
      cd "$IOS_DIR"
      pod install
    )
    if [ ! -f "$IOS_DIR/Pods/Pods.xcodeproj/project.pbxproj" ] ||
      ! cmp -s "$IOS_DIR/Podfile.lock" "$IOS_DIR/Pods/Manifest.lock"
    then
      echo "CocoaPods did not produce a complete graph matching Podfile.lock." >&2
      return 1
    fi
    printf '%s\n' "$input_fingerprint" >"$fingerprint_path"
  else
    echo "Using the CocoaPods graph matching Podfile.lock and workspace dependency inputs."
  fi
}
