# North Coast subdivision pilot

Each U.S. Live port is the polygon of a Census **county subdivision (COUSUB)**. The ten-digit port GEOID is `STATEFP + COUNTYFP + COUSUBFP`. Its first five digits identify the parent county.

The API catalog covers 404 California subdivisions. The bundled Live geometry covers ten subdivisions across Humboldt (`06023`) and Del Norte (`06015`). Only these ten can open Live markets, using foreground location after explicit opt-in. Coverage is a software pilot and has no on-device field certification. The compass gives no travel directions or designated stops. Follow local access rules.

## Replay

```sh
npm --prefix mobile ci
npm test
```

The registered Android app test replays Eureka CCD (`0602390930`) → Arcata CCD (`0602390100`), both in Humboldt. It checks repeat fixes, jitter near their shared boundary, stale or denied fixes, trade, kept legacy data and relaunch. All checked locations are synthetic inputs based on public geometry.

A fresh fix with a positive reported accuracy of at most 100 m must be wholly inside one subdivision, with 35 m of extra clearance. This allowance covers datum differences and uncertainty beyond the reported accuracy. Access expires after 30 seconds or pauses on backgrounding, permission or signal errors, an ambiguous boundary, or outside coverage. Only active GEOID and expiry are kept for authorization, and authorization is never saved. Visits, market and ship progress stay local. No app location or player data goes to the backend.

## Compass ranges

The compass is north-up. Live uses the most recent usable on-device measurement
and shows an approximate straight-line range to the nearest point on each
port’s boundary. A latitude-adjusted projection selects the nearest point on the
short boundary segments, and a great-circle distance and true bearing describe
that point. The active port has a status label in place of a number. Near a
boundary, a usable fix can show ranges while the market stays locked. Without a
fresh, accurate fix, Live ranges are unavailable. Training measures from the
simulated ship to each scenario’s recorded position. Neither compass provides
road routes. Exact fixes used by the compass are held temporarily in memory.

In Training, the scenario list preserves the seven fictional scenarios and existing contracts. Some scenarios share a subdivision. Their identities are local simulation IDs. Existing Training saves keep their map. Older point-based Live saves remain archived locally, with compatible ship, credits and cargo copied forward into the first new Live campaign. Old station progress is kept in the archived save. Explicit Live reset clears both Live saves and old point-docking records.

## Shapefile provenance

The [2025 U.S. Census TIGER/Line Shapefiles release](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2025.html) is the source. The exact archive is [California County Subdivisions](https://www2.census.gov/geo/tiger/TIGER2025/COUSUB/tl_2025_06_cousub.zip), SHA-256 `155fc08243cd83ef39c7bc510f793b0ac43b8be2d907b51ceb5253150b68c2a4`.

```sh
curl -fLO https://www2.census.gov/geo/tiger/TIGER2025/COUSUB/tl_2025_06_cousub.zip
python tools/import-cousub.py tl_2025_06_cousub.zip
git diff --exit-code -- mobile/src/territories/cousub
```

GDAL 3.10.3 extracts the official records. The geometry remains in source NAD83 (EPSG:4269), using longitude then latitude. Every ordinate is checked for exact reversibility at one-millionth of a degree before delta-polyline encoding. Polygon parts, ring nesting and coordinates are preserved. Android accounts for datum uncertainty in its clearance margin. The arrival engine and compass boundary lookup use the full geometry.

### Local backend

- `GET /v2/ports` returns the California index, source checksum, and pilot availability flags.
- `GET /v2/ports/{geoid}/boundary` returns the exact lossless runtime polygons for a pilot subdivision.
- `GET /v1/territories` remains the previous Training atlas contract.
- `GET /healthz` checks readiness.
