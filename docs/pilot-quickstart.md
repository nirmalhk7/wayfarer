# U.S. county port atlas

The Live atlas covers 3,144 counties and county equivalents in all 50 states and D.C. Each port uses a stable namespaced ID, such as `county:06081`. Moving within one county keeps the same market. A confirmed crossing, including across a state line, updates the Compass. Walking in the new port logs a visit and unlocks its market. Software replay covers the transition. Physical field testing is pending.

## Build from source

Use Python 3 with GDAL bindings (verified with GDAL 3.10.3 and Python 3.13) and Shapely 2.1.2. The [2026 U.S. Census TIGER/Line release](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) provides the [national county Shapefile](https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip). The importer checks its 83,378,454-byte archive against the pinned SHA-256 in `tools/tiger2026-county-source.json`.

```sh
curl -fLO https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip
python3 tools/build-port-atlas.py tl_2026_us_county.zip tools/tiger2026-county-source.json ./atlas-output
```

The compiler keeps NAD83 coordinates and polygon rings, including holes and detached parts. It handles the date line, clips geometry into overlapping one-degree regions and rounds runtime coordinates to seven decimal places without simplifying. The compiler emits 1,570 gzip regions totaling 64,764,758 bytes and a separate GEOID registry. Its largest decoded region is 841,534 bytes. The builder prints the release index SHA-256 to pin in Android. Release archives and generated regions belong outside Git and outside the APK.

The full build joins `tools/county2026-game-ranks.tsv` to the Shapefile on the five-character GEOID and writes integer `crime_rank` and `patrol_rank` to every county in `counties.json`. Missing, duplicate, unexpected, or invalid rows fail the build. The compact TSV preserves the raw 3–6 values from the grouped Codex GPT-6 Luna High dataset (source JSON SHA-256 `c9c3590832be7ae8b1e8376aec09965d28ad306cf48a31f36e9ea073a6b96d8a`). These uncalibrated fictional gameplay scores describe neither actual crime and safety nor police staffing or patrol activity. The ranks are registry metadata only. The index records the registry checksum and `sources.json` records the TSV checksum and provenance.

The ranked national output is `county2026-v2`. Its index and tiles retain the `county2026-v1` geometry protocol so existing Android builds can read them with the new URL and index checksum. Partial `--states` builds retain the legacy output format and omit ranks. Use a fresh output root when testing partial builds.

## Serve and replay

```sh
WAYFARER_ATLAS_TEST_DATA="$PWD/atlas-output/county2026-v2" npm test
WAYFARER_ATLAS_DIR="$PWD/atlas-output" npm run backend
```

The loopback backend serves `GET /atlas/county2026-v2/index.json`, `/counties.json`, `/sources.json` and `/tiles/{longitudeDegree}_{latitudeDegree}.json` under that prefix. It can also serve an existing `county2026-v1` release from its own directory. Tile requests with gzip support receive precompressed bytes. The historical `/v1/territories` remains available for Training consumers. The retired subdivision endpoints return HTTP 410.

Production builds need an HTTPS base URL ending at the release directory. Set `EXPO_PUBLIC_PORT_ATLAS_URL` and `EXPO_PUBLIC_PORT_ATLAS_SHA256` when building Android. The Android emulator can use `http://10.0.2.2:4197/atlas/county2026-v2` in development, subject to Android’s cleartext networking policy. Hosts must serve immutable index and tile resources at these URLs. The app verifies the pinned index hash and each tile’s decoded byte length and checksum before use. No public atlas host is configured by default.

The registered Expo tests replay within San Mateo, across San Mateo and San Francisco, near an ambiguous border, and with stale, denied or unavailable fixes. Geometry tests also replay the Oregon–Washington border and both sides of the date line in Alaska. The backend suite checks actual HTTP responses. Use public synthetic fixes and cache a test region before testing airplane mode.

## Location and saves

Live requires opt-in, a foreground fix no older than 30 seconds and reported accuracy of at most 100 m. A position must be confidently inside a single port with an extra 35 m of clearance. Live trading requires the walking check described in the [Android guide](../mobile/README.md).

Android holds measured positions temporarily in memory. HTTP requests include a coarse one-degree region identifier, which a host can see. They do not include measured GPS coordinates, ship data or player progress. Revisit downloaded regions offline. The Compass shows approximate straight-line distance and true bearing to nearby boundaries it can calculate without crossing the current region’s geometry limits. The current port gets a status label.

Training and Live use separate saves. Existing Live credits, ship upgrades and cargo carry forward, and old markets remain in the archived local save. Explicit Live reset clears the campaign and legacy Live saves.
