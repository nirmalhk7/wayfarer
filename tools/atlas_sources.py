"""Official inputs for the county-only Wayfarer atlas."""
import hashlib

REVISION = "county2026-v1"
STATES = tuple("01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56".split())
SOURCE = "https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()
