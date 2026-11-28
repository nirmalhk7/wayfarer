# Wayfarer

Wayfarer is an Android space-trading game. Every county or county equivalent in the 50 states and D.C. is a Live port. A confirmed crossing updates the Compass. Walking in the new port logs a visit and unlocks its market. GitHub APK previews include the nationwide atlas so Android can locate ports offline. Training runs offline with its own contracts, markets and saves.

## Run locally

Use Node.js 22.13 or later and Android Studio with a device or emulator.

```sh
npm --prefix mobile ci
npm test
npm --prefix mobile run android
```

The main-branch preview workflow compiles and verifies the full offline atlas before publishing the APK. See the [atlas build, local replay and hosting guide](docs/pilot-quickstart.md) and [Android build instructions](mobile/README.md).
