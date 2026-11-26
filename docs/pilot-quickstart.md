# North Coast Training pilot

The chart maps seven fictional stations across Humboldt and Del Norte counties. County membership is a chart label. Docking qualification separately governs access to each station market. The catalog is generalized for games and thematic mapping. It is unsuitable for navigation or legal boundary determinations.

## Reproduce the Android playthrough

From the repository root, install once with `npm --prefix mobile ci`. Run `npm test` to test the loopback API and registered Android entry point with mocked native services. On a configured device or emulator, run `npm --prefix mobile run android`.

1. Start on **Bridge** in Training. It requests no location permission on launch. Open **Chart**, then the port list, and confirm the county labels.
2. Return to Wayfarer Freeport in Humboldt County. Simulate the approach and resolve the encounter if prompted. Enter the station and accept **Cinder Reserve Run** at the contract desk. Buy two Ion Fuel at the trade counter.
3. Plot Cinder Exchange in Del Norte County from the chart. The destination’s county is visible on approach, while delivery stays locked. Simulate the 10-minute qualification and finish any encounter, then deliver from its contract desk for 150 credits.
4. Check the reward after relaunch. Open **Hold** to buy an upgrade. Use **Reset Training game data** only when you are ready to reset that local campaign.

Do not travel to any Training pin or generated Live test point. No North Coast stations have been cleared for physical arrival. A physical pilot requires independently verified public stops and routes, field checks, and on-device docking tests.

## Boundary release and backend

The source is the U.S. Census Bureau’s [2025 Cartographic Boundary Files](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.2025.html), [national counties shapefile at 1:500,000](https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip). The packaged release is `north-coast-2025-cb500k.v1`. The importer checks the downloaded archive’s SHA-256, selects GEOIDs `06015` and `06023`, and outputs WGS 84 GeoJSON with six decimal places. It preserves multipart polygons and uses no extra simplification.

```sh
curl -fLO https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip
python tools/import-north-coast.py cb_2025_us_county_500k.zip
git diff --exit-code -- mobile/src/territories/north-coast.json
```

Use GDAL 3.10.3 for byte-for-byte regeneration. The app and local API share the same file. From the root, `npm run backend` serves it at `GET /v1/territories` and reports readiness at `GET /healthz`. The backend accepts no player data, uploads or location queries. There is no login or save sync.
