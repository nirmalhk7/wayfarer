# Wayfarer Android

Native Android space-trading game built with Expo and React Native. The Wayward
flies between fictional stations. Training opens on the North Coast chart of
Humboldt and Del Norte counties, using the bundled Census boundary release.
Station pins in Training are fictional. Public field stations are unavailable.

## Play loop

- Follow market rumors and choose a station on the chart.
- Simulate approach and docking qualification in Training, then visit the station
  to trade cargo or complete a delivery. County membership alone grants no docking.
- Expand the hold or reinforce the hull. Progress persists in a local save.

Training starts without requesting location. Select Live and then **Start live
navigation** to opt in to the legacy experimental mode. Live uses a first location
fix to generate test points around a freeport. These points are unaudited. Do not
travel to them. Experimental docking requires accurate, stationary time within
the selected port’s 120-metre perimeter for 10 observed minutes.

Android background location is optional. Training and Live use separate local
saves. Older Training saves retain their previous map until reset. Raw location
samples and trails are never persisted.

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
