#!/usr/bin/env python3
"""Build static, immutable effective port tiles from official TIGER/Line inputs."""
import argparse
import gzip
import hashlib
import json
import math
import sqlite3
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from osgeo import ogr
from shapely import from_wkb, make_valid, to_wkb, union_all
from shapely.affinity import translate
from shapely.geometry import Polygon, box

from atlas_sources import REVISION, SOURCE, STATES, digest

HALO = .25
SCALE = 10_000_000
ogr.UseExceptions()


def polygons(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        if geometry.area:
            yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygons(part)


def unwrap_ring(ring):
    return [(x + 360 if x < 0 else x, y) for x, y in ring.coords]


def aliases(part):
    if part.bounds[2] - part.bounds[0] > 180:
        part = Polygon(unwrap_ring(part.exterior), [unwrap_ring(ring) for ring in part.interiors])
        if part.bounds[2] - part.bounds[0] > 180:
            raise ValueError("Cannot unwrap an antimeridian polygon")
    if not part.is_valid:
        part = make_valid(part)
    for component in polygons(part):
        for offset in (0, -360, 360):
            west, _, east, _ = component.bounds
            if east + offset >= -180 - HALO and west + offset <= 180 + HALO:
                yield translate(component, xoff=offset) if offset else component


def index_sources(connection, archive, source, states):
    if source["url"] != SOURCE or source["sha256"] != digest(archive):
        raise ValueError("County shapefile differs from its source lock")
    connection.executescript("""
      CREATE TABLE geometry (id INTEGER PRIMARY KEY, key TEXT, name TEXT, wkb BLOB);
      CREATE VIRTUAL TABLE spatial USING rtree (id, minx, maxx, miny, maxy);
    """)
    registry, tiles, coverage = {}, set(), set()
    dataset = ogr.Open("/vsizip/" + str(archive.resolve()))
    features = dataset.GetLayer(0)
    if features.GetSpatialRef().GetAuthorityCode(None) != "4269":
        raise ValueError("Unexpected county coordinate system")
    for feature in features:
        state = feature["STATEFP"]
        if state not in states:
            continue
        coverage.add(state)
        geoid = feature["GEOID"]
        if geoid != state + feature["COUNTYFP"] or geoid in registry:
            raise ValueError(f"Unexpected county identity: {geoid}")
        name = feature["NAME"]
        if feature["LSAD"] == "25":
            name += " city"  # Distinguishes independent cities with a same-name neighbor.
        registry[geoid] = {"id": "county:" + geoid, "geoid": geoid, "stateGeoid": state, "name": name}
        geometry = from_wkb(bytes(feature.GetGeometryRef().ExportToIsoWkb()))
        for part in polygons(geometry):
            for polygon in aliases(part):
                west, south, east, north = polygon.bounds
                index = connection.execute("INSERT INTO geometry(key,name,wkb) VALUES(?,?,?)",
                                           ("county:" + geoid, name, to_wkb(polygon))).lastrowid
                connection.execute("INSERT INTO spatial VALUES(?,?,?,?,?)", (index, west, east, south, north))
                for x in range(max(-180, math.floor(west - HALO)), min(179, math.floor(east + HALO)) + 1):
                    for y in range(max(-90, math.floor(south - HALO)), min(89, math.floor(north + HALO)) + 1):
                        tiles.add((x, y))
    if coverage != set(states):
        raise ValueError(f"Missing states: {sorted(set(states)-coverage)}")
    if len(states) == len(STATES) and len(registry) != 3144:
        raise ValueError("The pinned full release must contain 3,144 port identities")
    print(f"Indexed {len(registry)} counties and equivalents across {len(coverage)} jurisdictions", flush=True)
    connection.commit()
    return tiles, registry


def encode_ring(ring):
    def encode(delta):
        value = delta * 2 if delta >= 0 else -delta * 2 - 1
        while value >= 32:
            yield chr(95 + value % 32)
            value //= 32
        yield chr(63 + value)

    previous = (0, 0)
    positions = []
    for x, y in ring.coords:
        point = (round(x * SCALE), round(y * SCALE))
        if not positions or point != positions[-1]:
            positions.append(point)
    if len(positions) < 4:
        return None
    chunks = []
    for point in positions:
        for axis in (0, 1):
            chunks.extend(encode(point[axis] - previous[axis]))
        previous = point
    return "".join(chunks)


def write_tile(work):
    database, output, x, y = work
    limits = (x - HALO, y - HALO, x + 1 + HALO, y + 1 + HALO)
    extent = box(*limits)
    west, south, east, north = limits
    with sqlite3.connect(database) as conn:
        rows = conn.execute("""
          SELECT key,name,wkb FROM spatial JOIN geometry USING(id)
          WHERE minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?
          ORDER BY key,id
        """, (east, west, north, south)).fetchall()
    candidates = {}
    for key, name, data in rows:
        clipped = from_wkb(data).intersection(extent)
        parts = list(polygons(clipped))
        if parts:
            candidates.setdefault(key, (name, []))[1].extend(parts)
    ports = []
    for key, (name, parts) in candidates.items():
        geometry = union_all(parts)
        encoded = []
        for polygon in polygons(geometry):
            outer = encode_ring(polygon.exterior)
            if outer:
                encoded.append([outer, *(ring for hole in polygon.interiors if (ring := encode_ring(hole)))])
        if encoded:
            bounds = [round(x, 7) for x in geometry.bounds]
            ports.append([key, name, bounds, encoded])
    if not ports:
        return None
    key = f"{x}_{y}"
    document = {"revision": REVISION, "tile": key, "limits": limits, "ports": ports}
    data = dump(document)
    zipped = gzip.compress(data, compresslevel=6, mtime=0)
    (output / "tiles" / (key + ".json.gz")).write_bytes(zipped)
    return key, {"bytes": len(data), "gzipBytes": len(zipped), "sha256": hashlib.sha256(data).hexdigest()}


def dump(data):
    return (json.dumps(data, separators=(",", ":"), ensure_ascii=False, sort_keys=True) + "\n").encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("lock", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--states", nargs="+", choices=STATES, default=STATES)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    states = sorted(set(args.states))
    source = json.loads(args.lock.read_text())
    release = args.output / REVISION
    release.mkdir(parents=True, exist_ok=True)
    (release / "tiles").mkdir(exist_ok=False)
    with tempfile.TemporaryDirectory(dir=args.output) as temporary:
        database = str(Path(temporary) / "geometry.sqlite")
        with sqlite3.connect(database) as connection:
            tiles, registry = index_sources(connection, args.archive, source, states)
        work = ((database, release, x, y) for x, y in sorted(tiles))
        index = {}
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            for idx, result in enumerate(pool.map(write_tile, work, chunksize=4), 1):
                if result:
                    key, metadata = result
                    index[key] = metadata
                if idx % 100 == 0:
                    print(f"Compiled {idx}/{len(tiles)} regions", flush=True)
    metadata = {"revision": REVISION, "year": 2026, "states": states, "halo": HALO, "scale": SCALE, "tiles": index}
    (release / "index.json").write_bytes(dump(metadata))
    (release / "sources.json").write_bytes(dump(source))
    (release / "counties.json").write_bytes(dump({
        "revision": REVISION, "ports": [registry[key] for key in sorted(registry)],
    }))
    print(json.dumps({
        "states": len(states), "counties": len(registry), "regions": len(index),
        "gzipBytes": sum(item["gzipBytes"] for item in index.values()),
        "largestDecodedTile": max(item["bytes"] for item in index.values()),
        "indexSha256": digest(release / "index.json"),
    }, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
