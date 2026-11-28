# Wayfarer Android

Wayfarer is an Android space-trading game. In Live, every U.S. county or county
equivalent in the 50 states and D.C. is a port. Location matching stays on the
phone. An accurate foreground fix shows the current port. GitHub APK previews include all port data for offline Live play. Walking detection is requested after an explicit Live start.
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
contracts and upgrade your ship. See the
[atlas build and replay guide](../docs/pilot-quickstart.md) for development builds.

Android disables app backup and excludes databases and shared preferences from
cloud backup and device transfer. When Training opens an old procedural save,
it replaces the old coordinates with a fixed simulated origin and preserves
ship progress and market state.

## Live encounters

A port can roll one fictional encounter on the first qualified walking visit.
The roll is stable for a campaign and port, with higher crime increasing pirate
odds and higher patrol increasing customs odds while modestly deterring pirates.
The verified v2 registry supplies the two gameplay ranks. Unranked ports and
unavailable or invalid rank data keep the legacy no-contact behavior. Already
logged visits do not reroll. Training keeps its existing docking encounters.

The game holds one pending Live alert at a time. It appears at its own port
during a qualified foreground visit. You can reopen a deferred alert from the
Bridge. Evade risks cargo or hull, Fight trades hull for credits, Stop pays a
pirate toll or customs inspection fee, and Surrender pays a larger settlement.
A saved resolution clears the pending alert. If a contact is already pending,
other visits can be logged without generating a second contact.

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

Build the pinned national atlas first, then run the same APK script as CI from the repository root with Android SDK 36 installed:

```sh
bash mobile/tools/build-preview-apk.sh ./outputs ./atlas-output/county2026-v2
```

The repository's MVP APK is signed with Android's debug key for direct testing.
Create a private production keystore before Play Store distribution.

## GitHub APK previews

[Android APK preview](https://github.com/nirmalhk7/wayfarer/actions/workflows/android-preview.yml)
builds after pushes to `main`. A manual run also requires `main`. The action runs
the app and backend tests, builds a standalone Android APK, and checks its
signing certificate, application ID, embedded bundle, and SHA-256 checksum.
The release job downloads and checks the GitHub assets before it publishes
a prerelease tagged `android-preview-<commit SHA>`.

Download the APK and checksum from [GitHub Releases](https://github.com/nirmalhk7/wayfarer/releases).
These sideload previews use the pinned public Expo template debug certificate.
Installs signed with another key need to be removed before installing the preview,
which removes their local saves. The APK includes offline Training and the full
Live atlas. The build verifies the registry and every geometry tile inside the APK.
The release ZIP contains the same verified atlas payload.
