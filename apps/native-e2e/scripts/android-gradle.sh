#!/bin/sh
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH= cd -- "$app_dir/../.." && pwd)
android_dir="$app_dir/android"

if [ -z "${ANDROID_HOME:-}" ] && [ -n "${ANDROID_SDK_ROOT:-}" ]; then
  ANDROID_HOME=$ANDROID_SDK_ROOT
  export ANDROID_HOME
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -n "${HOME:-}" ]; then
  for android_sdk_candidate in \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/Sdk"
  do
    if [ -d "$android_sdk_candidate" ]; then
      ANDROID_HOME=$android_sdk_candidate
      export ANDROID_HOME
      break
    fi
  done
fi

if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "Set ANDROID_HOME to an installed Android SDK directory." >&2
  exit 1
fi

pnpm --dir "$repo_root" --filter '@solid-native/native-e2e...' build
cd "$android_dir"
exec ./gradlew "$@"
