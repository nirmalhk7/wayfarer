"""Produce Wayfarer's two-county GeoJSON from the pinned U.S. Census shapefile."""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE_URL = "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip"
SOURCE_SHA256 = "aa976c00b181939755d0da757f4c7c2dc0103c3b3b4530fb2a91c2bb62fc777c"
TARGET = Path(__file__).resolve().parents[1] / "mobile/src/territories/north-coast.json"


def main():
    archive = Path(sys.argv[1]).resolve()
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit(f"Archive differs from the pinned Census release: {archive}")
    with tempfile.TemporaryDirectory() as temporary:
        extracted = Path(temporary) / "north-coast.json"
        subprocess.run([
            "ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326",
            "-lco", "RFC7946=YES", "-lco", "COORDINATE_PRECISION=6",
            "-nlt", "MULTIPOLYGON", "-where", "GEOID IN ('06015','06023')",
            "-select", "GEOID,NAME", str(extracted), f"/vsizip/{archive}",
        ], check=True)
        data = json.loads(extracted.read_text())
    features = []
    for feature in sorted(data["features"], key=lambda item: item["properties"]["GEOID"]):
        fips = feature["properties"]["GEOID"]
        features.append({
            "type": "Feature",
            "id": fips,
            "properties": {"name": f"{feature['properties']['NAME']} County", "fips": fips},
            "geometry": feature["geometry"],
        })
    if [feature["id"] for feature in features] != ["06015", "06023"]:
        raise SystemExit("Unexpected county set")
    release = {
        "type": "FeatureCollection",
        "revision": "north-coast-2025-cb500k.v1",
        "source": {
            "publisher": "U.S. Census Bureau",
            "dataset": "2025 Cartographic Boundary Files, Counties, 1:500,000",
            "url": SOURCE_URL,
            "sha256": SOURCE_SHA256,
        },
        "features": features,
    }
    # Keep one feature per line so metadata and county changes are easy to review.
    metadata = {key: value for key, value in release.items() if key != "features"}
    header = json.dumps(metadata, indent=2)[:-2]
    rows = ",\n".join("    " + json.dumps(f, separators=(",", ":")) for f in features)
    TARGET.write_text(header + ',\n  "features": [\n' + rows + "\n  ]\n}\n")


if __name__ == "__main__":
    main()
