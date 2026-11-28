#!/usr/bin/env bash
# Build an offline sideload preview with Expo's pinned template signing identity.
set -euo pipefail

output=${1:?Pass an output directory for the APK and checksum}
mkdir -p -- "$output"
output=$(cd -- "$output" && pwd)
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
: "${sdk:?Set ANDROID_HOME or ANDROID_SDK_ROOT to the Android SDK}"
tools="$sdk/build-tools/36.0.0"
test -x "$tools/apksigner"
test -x "$tools/aapt"

./node_modules/.bin/expo prebuild --platform android --no-install
# No Metro server is required. Gradle embeds the app and assets in this variant.
(cd android && ./gradlew --no-daemon :app:clean :app:assembleRelease)

apk=android/app/build/outputs/apk/release/app-release.apk
test -s "$apk"
unzip -tq "$apk"
unzip -Z1 "$apk" | grep -Fx 'assets/index.android.bundle'
verification=$("$tools/apksigner" verify --verbose --print-certs "$apk")
printf '%s\n' "$verification"
# Pin the certificate from the SDK 57.0.12 prebuild template, not a secret.
# Fail if an SDK upgrade or signing configuration unexpectedly changes it.
grep -Fx 'Signer #1 certificate SHA-256 digest: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c' <<< "$verification"
badging=$("$tools/aapt" dump badging "$apk")
grep -E "^package: name='com\.nirmalhk7\.wayfarer' " <<< "$badging"
if grep -q '^application-debuggable' <<< "$badging"; then
  echo 'Preview must use a non-debuggable release build' >&2
  exit 1
fi

name=Wayfarer-android-preview.apk
install -m 0644 "$apk" "$output/$name"
(cd "$output" && sha256sum "$name" > "$name.sha256" && sha256sum -c "$name.sha256")
