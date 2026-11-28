# Wayfarer Android

Wayfarer is an Android space-trading game. In Live, every U.S. county or county
equivalent in the 50 states and D.C. is a port. Location matching stays on the
phone. An accurate foreground fix shows the current port. Android reuses downloaded
regions offline. Walking detection is requested after an explicit Live start.
If permission is denied or Android activity recognition is unavailable, the
Compass still works and visits and markets stay locked. Use Retry Live
navigation after changing the Android Physical activity setting.

Visit credit needs at least 12 seconds of high-confidence walking reports
inside one port, without conflicting activity, and 12 m of displacement
beyond the two reported accuracy radii within a 50-second window. Each
fix must have accuracy within 25 m and a known speed at or below 2.5 m/s.
Fixes and motion reports expire after 10 and 15 seconds, respectively.
Vehicle or cycling detection, measured speed above 2.5 m/s, or equivalent
accuracy-adjusted displacement clears the check and waits 30 seconds to
start again. A stationary report can keep a qualified market open for up
to two minutes after its last qualifying walking report, while eligible
fixes and motion reports stay fresh in the same port. An unknown or stale
signal clears the check. Motion and GPS fixes stay in foreground memory.
Existing visits and campaign progress are preserved.

Training opens offline with its own save. Simulate arrivals, trade, deliver
contracts and upgrade your ship. To enable Live on a new build, see the
[atlas hosting and replay guide](../docs/pilot-quickstart.md).

Android disables app backup and excludes databases and shared preferences from
cloud backup and device transfer. When Training opens an old procedural save,
it replaces the old coordinates with a fixed simulated origin and preserves
ship progress and market state.

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
