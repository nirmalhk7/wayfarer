# Wayfarer Android

Wayfarer is an Android space-trading game. In Live, every U.S. county or county
equivalent in the 50 states and D.C. is a port. Location matching stays on the
phone. An accurate foreground fix opens a new market after you cross into
another port. Android reuses downloaded regions offline.

Training opens offline with its own save. Simulate arrivals, trade, deliver
contracts and upgrade your ship. To enable Live on a new build, see the
[atlas hosting and replay guide](../docs/pilot-quickstart.md).

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
