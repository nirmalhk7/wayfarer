# Wayfarer

Wayfarer is an Android space-trading game built around real geography. Command the freighter The Wayward, find favorable prices, deliver cargo, and put the earnings into your ship.

The **North Coast Training** campaign maps fictional stations to Humboldt and Del Norte counties, California. It uses the U.S. Census Bureau’s 2025 county boundaries offline. The displayed station pins are fictional. Public field stations are unavailable. Training simulates docking and uses a separate save. Live navigation requires an explicit start and remains a separate experimental mode.

## Run locally

Use Node.js 22.13 or later and a configured Android SDK with a device or emulator.

```sh
npm --prefix mobile ci
npm --prefix mobile run android
```

```sh
npm test
```

The optional local backend serves the versioned boundary catalog that Android bundles. It listens on loopback and serves public boundaries. The Android game works offline with the same catalog and keeps campaign progress on the device.

```sh
npm run backend
curl http://127.0.0.1:4197/healthz
curl http://127.0.0.1:4197/v1/territories
```

See the [North Coast playthrough and data provenance](docs/pilot-quickstart.md) and [Android build instructions](mobile/README.md).
