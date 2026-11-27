# Wayfarer

Wayfarer is an Android space-trading game. In U.S. Live play, **one port is one official Census county subdivision (COUSUB)**. The full ten-digit GEOID identifies its market, including the five-digit parent county GEOID. Crossing into another subdivision opens that port’s market once your phone confirms where you are, even within the same county.

The pinned 2025 TIGER/Line shapefile gives the backend an index of all 404 California county subdivisions. Android Live play is a foreground pilot for ten subdivisions in Humboldt and Del Norte counties. This coverage has been replayed with synthetic fixes. Physical field verification remains pending. The app’s compass shows straight-line ranges to nearby ports and gives no travel directions.

Training opens offline and preserves its existing shipping, trade and upgrade scenarios. Its fictional scenarios use simulated approaches and keep a separate save.

## Run locally

Use Node.js 22.13 or later and a configured Android SDK with a device or emulator.

```sh
npm --prefix mobile ci
npm test
npm --prefix mobile run android
```

The optional loopback API serves the versioned catalog and official pilot geometry. Android uses bundled data and resolves location on the device.

```sh
npm run backend
curl http://127.0.0.1:4197/v2/ports
curl http://127.0.0.1:4197/v2/ports/0602390100/boundary
```

See the [pilot quickstart and exact Shapefile provenance](docs/pilot-quickstart.md) and [Android build instructions](mobile/README.md).
