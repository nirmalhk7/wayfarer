# Wayfarer Android

Wayfarer is a native Android space-trading game. Every U.S. Live port is one
official TIGER/Line Census county subdivision, identified by its ten-digit GEOID.
An accurate foreground fix can open a new market on crossing a subdivision
boundary. You can cross to a new port without leaving the same parent county.

Live starts only after an opt-in. Location matching stays on the device. Live
markets pause near ambiguous borders, outside coverage, when a fix expires, and
while the app is in the background. The North Coast pilot covers ten subdivisions
in Humboldt and Del Norte counties. Field verification is pending.

Training opens offline. Plot simulated approaches, trade, deliver contracts and
upgrade your ship. It uses a separate save. Training scenarios can share the same
subdivision and carry no Live access. See the [full pilot and source notes](../docs/pilot-quickstart.md).

## Run during development

```sh
npm ci
npm run android
```

Android Studio and an Android SDK are required. The app targets Android 16 and
supports Android 7.0 or newer (`minSdk 24`).

## Verify

```sh
npm run check
```

## Build an APK

Generate the native project after changing `app.json`, then build:

```sh
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

The repository's MVP APK is signed with Android's debug key for direct testing.
Create a private production keystore before Play Store distribution.
