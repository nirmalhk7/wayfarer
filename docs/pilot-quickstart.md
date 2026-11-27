# U.S. county port atlas

The Live atlas covers 3,144 counties and county equivalents in all 50 states and D.C. Each port uses a stable namespaced ID, such as `county:06081`. Moving within one county keeps the same market. A confirmed crossing, including across a state line, opens the next port. Software replay covers the transition. Physical field testing is pending.

## Build from source

Use Python 3 with GDAL bindings (verified with GDAL 3.10.3 and Python 3.13) and Shapely 2.1.2. The [2026 U.S. Census TIGER/Line release](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) provides the [national county Shapefile](https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip). The importer checks its 83,378,454-byte archive against the pinned SHA-256 in `tools/tiger2026-county-source.json`.

```sh
curl -fLO https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip
python3 tools/build-port-atlas.py tl_2026_us_county.zip tools/tiger2026-county-source.json ./atlas-output
```

The compiler keeps NAD83 coordinates and polygon rings, including holes and detached parts. It handles the date line, clips geometry into overlapping one-degree regions and rounds runtime coordinates to seven decimal places without simplifying. The compiler emits 1,570 gzip regions totaling 64,764,758 bytes and a separate GEOID registry. Its largest decoded region is 841,534 bytes. The verified `index.json` SHA-256 is `76e2a77500c012f077575183a899ae23a913f27e97c0ab1b2656dee01deaa337`. Release archives and generated regions belong outside Git and outside the APK.

## Serve and replay

```sh
WAYFARER_ATLAS_TEST_DATA="$PWD/atlas-output/county2026-v1" npm test
WAYFARER_ATLAS_DIR="$PWD/atlas-output" npm run backend
```

The loopback backend serves `GET /atlas/county2026-v1/index.json`, `/counties.json`, `/sources.json` and `/tiles/{longitudeDegree}_{latitudeDegree}.json` under that prefix. Tile requests with gzip support receive precompressed bytes. The historical `/v1/territories` remains available for Training consumers. The retired subdivision endpoints return HTTP 410.

Production builds need an HTTPS base URL ending at the release directory. Set `EXPO_PUBLIC_PORT_ATLAS_URL` and `EXPO_PUBLIC_PORT_ATLAS_SHA256` when building Android. The Android emulator can use `http://10.0.2.2:4197/atlas/county2026-v1` in development, subject to Android’s cleartext networking policy. Hosts must serve immutable index and tile resources at these URLs. The app verifies the pinned index hash and each tile’s decoded byte length and checksum before use. No public atlas host is configured by default.

The registered Expo tests replay within San Mateo, across San Mateo and San Francisco, near an ambiguous border, and with stale, denied or unavailable fixes. Geometry tests also replay the Oregon–Washington border and both sides of the date line in Alaska. The backend suite checks actual HTTP responses. Use public synthetic fixes and cache a test region before testing airplane mode.

## Location and saves

Live requires opt-in, a foreground fix no older than 30 seconds and reported accuracy of at most 100 m. A position must be confidently inside a single port with an extra 35 m of clearance. Live trading pauses while a required region is missing, while the position is ambiguous or when location access becomes unavailable.

Android holds measured positions temporarily in memory. HTTP requests include a coarse one-degree region identifier, which a host can see. They do not include measured GPS coordinates, ship data or player progress. Revisit downloaded regions offline. The Compass shows approximate straight-line distance and true bearing to nearby boundaries it can calculate without crossing the current region’s geometry limits. The current port gets a status label.

Training and Live use separate saves. Existing Live credits, ship upgrades and cargo carry forward, and old markets remain in the archived local save. Explicit Live reset clears the campaign and legacy Live saves.
