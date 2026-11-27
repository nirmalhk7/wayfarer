"""Build the California port index and lossless North Coast TIGER/Line geometry."""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

URL = "https://www2.census.gov/geo/tiger/TIGER2025/COUSUB/tl_2025_06_cousub.zip"
SHA256 = "155fc08243cd83ef39c7bc510f793b0ac43b8be2d907b51ceb5253150b68c2a4"
VINTAGE = "tiger-2025-ca-cousub.v1"
COUNTIES = {"06015": "Del Norte County", "06023": "Humboldt County"}
OUT = Path(__file__).resolve().parents[1] / "mobile/src/territories/cousub"


def encode_ring(ring):
    def varint(delta):
        value = (delta * 2) if delta >= 0 else (-delta * 2 - 1)
        while value >= 32:
            yield chr(63 + 32 + value % 32)
            value //= 32
        yield chr(63 + value)

    previous = [0, 0]
    encoded = []
    assert len(ring) >= 4 and ring[0] == ring[-1]
    for pair in ring:
        assert len(pair) == 2
        for axis, value in enumerate(pair):
            scaled = round(value * 1_000_000)
            assert scaled / 1_000_000 == value, f"Shapefile precision would be lost: {value}"
            encoded.extend(varint(scaled - previous[axis]))
            previous[axis] = scaled
    return "".join(encoded)


def features(archive, folder, *, boundaries):
    output = folder / ("boundaries.json" if boundaries else "index.json")
    args = ["ogr2ogr", "-f", "GeoJSON", str(output), f"/vsizip/{archive}"]
    if boundaries:
        args += ["-where", "COUNTYFP IN ('015','023')", "-nlt", "PROMOTE_TO_MULTI", "-lco", "COORDINATE_PRECISION=17"]
    else:
        args += ["-nlt", "NONE", "-select", "GEOID,GEOIDFQ,STATEFP,COUNTYFP,COUSUBFP,COUSUBNS,NAMELSAD,LSAD,CLASSFP,MTFCC,FUNCSTAT,ALAND,AWATER"]
    subprocess.run(args, check=True)
    return json.loads(output.read_text())["features"]


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    archive = Path(sys.argv[1]).resolve()
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise SystemExit("SHA-256 differs from the pinned Census archive.")
    with tempfile.TemporaryDirectory() as temporary:
        out = Path(temporary)
        index = features(archive, out, boundaries=False)
        shapes = features(archive, out, boundaries=True)
    pilot = {}
    for feature in shapes:
        properties = feature["properties"]
        geoid = properties["GEOID"]
        geometry = feature["geometry"]
        assert geometry["type"] == "MultiPolygon"
        polygons = geometry["coordinates"]
        positions = [pair for polygon in polygons for ring in polygon for pair in ring]
        bounds = [min(pair[0] for pair in positions), min(pair[1] for pair in positions),
                  max(pair[0] for pair in positions), max(pair[1] for pair in positions)]
        pilot[geoid] = {
            "geoid": geoid, "name": properties["NAMELSAD"],
            "countyGeoid": geoid[:5], "countyName": COUNTIES[geoid[:5]],
            "bounds": bounds,
            "referencePoint": [float(properties["INTPTLON"]), float(properties["INTPTLAT"])],
        }
        write(OUT / f"{geoid}.json", [[encode_ring(ring) for ring in polygon] for polygon in polygons])
    public_ports = []
    for feature in sorted(index, key=lambda f: f["properties"]["GEOID"]):
        attrs = feature["properties"]
        assert attrs["GEOID"] == attrs["STATEFP"] + attrs["COUNTYFP"] + attrs["COUSUBFP"]
        public_ports.append({
            "geoid": attrs["GEOID"], "fullyQualifiedGeoid": attrs["GEOIDFQ"],
            "name": attrs["NAMELSAD"], "countyGeoid": attrs["GEOID"][:5],
            "stateGeoid": attrs["STATEFP"], "countySubdivisionCode": attrs["COUSUBFP"],
            "gnis": attrs["COUSUBNS"], "legalStatisticalAreaCode": attrs["LSAD"],
            "classCode": attrs["CLASSFP"], "featureClass": attrs["MTFCC"], "functionalStatus": attrs["FUNCSTAT"],
            "landSquareMeters": attrs["ALAND"], "waterSquareMeters": attrs["AWATER"],
            "liveAvailability": "foreground-pilot" if attrs["GEOID"] in pilot else "outside-pilot",
        })
    assert len(public_ports) == len({p["geoid"] for p in public_ports}) == 404
    assert len(pilot) == 10
    write(OUT / "catalog.json", {
        "unit": "COUSUB", "revision": VINTAGE,
        "source": {"publisher": "U.S. Census Bureau", "vintage": 2025, "archive": URL, "sha256": SHA256, "crs": "EPSG:4269"},
        "coverage": {"catalogStateGeoids": ["06"], "liveCountyGeoids": sorted(COUNTIES), "fieldVerified": False,
                     "liveAvailability": "foreground-pilot", "geometryEncoding": "delta-polyline-lon-lat-1e6"},
        "ports": public_ports,
    })
    write(OUT / "pilot.json", [pilot[geoid] for geoid in sorted(pilot)])


if __name__ == "__main__":
    main()
