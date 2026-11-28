# Wayfarer

Wayfarer is an Android space-trading game. Every county or county equivalent in the 50 states and D.C. is a Live port. A confirmed crossing updates the Compass. Walking in the new port logs a visit and unlocks its market. Android checks the phone’s position locally against downloaded regions. Training runs offline with its own contracts, markets and saves.

## Run locally

Use Node.js 22.13 or later and Android Studio with a device or emulator.

```sh
npm --prefix mobile ci
npm test
npm --prefix mobile run android
```

An Android build needs the published atlas URL and index checksum to enable Live downloads. See the [atlas build, local replay and hosting guide](docs/pilot-quickstart.md) and [Android build instructions](mobile/README.md).
