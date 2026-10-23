# Wayfarer Android MVP

Native Android location game built with Expo and React Native. A campaign uses the
player’s first GPS fix to generate six walkable starports around a local freeport.
These procedural coordinates are synthetic test content, not verified public POIs
or a claim that any generated place is safe or appropriate to visit.

## Play loop

- Follow approximate market rumors on the star chart.
- Select a starport, move fully within its 120-metre perimeter, and remain nearby,
  accurate, and stationary for 10 observed minutes. Docking completes automatically.
- Buy and sell four commodities using exact prices available only while docked.
- Expand the cargo hold or reinforce the hull.
- Resolve pirate, customs, and distress encounters.
- Resume from an offline save after closing the app.

Live and Training are isolated campaigns with separate saves, credits, cargo,
markets, discoveries, and encounters. Training can simulate the 10-minute timer
without changing live progress. It is selected automatically when foreground
location permission is unavailable.

Foreground location supports qualification while Wayfarer remains visible.
Background location is optional; on Android 11+ Wayfarer explains its use before
opening system settings. Only bounded docking-session totals are stored. Raw
location samples and travel trails are never persisted.

## Run during development

```sh
npm install
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
