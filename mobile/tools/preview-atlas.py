"""Stage the pinned atlas as Android assets, or verify the packaged APK payload."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ASSET_DIRECTORY = "wayfarer-atlas"
PIN = json.loads((Path(__file__).resolve().parents[1] / "src/atlas/bundled.json").read_text())["indexSha256"]


def verify(read):
    def checked(path, digest, size=None):
        data = read(path)
        if hashlib.sha256(data).hexdigest() != digest or (size is not None and len(data) != size):
            raise ValueError(f"Atlas integrity check failed: {path}")
        return data

    index = json.loads(checked("index.json", PIN))
    registry = json.loads(checked("counties.json", index["countiesSha256"]))
    for tile, entry in index["tiles"].items():
        checked(f"tiles/{tile}.json", entry["sha256"], entry["bytes"])

    print(f"Verified {len(registry['ports'])} ports, {len(index['tiles'])} tiles, "
          f"{len(index['states'])} jurisdictions (index {PIN})")


def stage(release, assets):
    target = assets / ASSET_DIRECTORY

    def read(path):
        if path.startswith("tiles/"):
            data = gzip.decompress((release / (path + ".gz")).read_bytes())
        else:
            data = (release / path).read_bytes()
        destination = target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        return data

    verify(read)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    stage_command = commands.add_parser("stage")
    stage_command.add_argument("release", type=Path)
    stage_command.add_argument("assets", type=Path)
    verify_command = commands.add_parser("verify")
    verify_command.add_argument("apk", type=Path)
    archive_command = commands.add_parser("archive")
    archive_command.add_argument("apk", type=Path)
    archive_command.add_argument("output", type=Path)
    args = parser.parse_args()

    if args.operation == "stage":
        stage(args.release, args.assets)
    else:
        with ZipFile(args.apk) as apk:
            def read(path):
                return apk.read(f"assets/{ASSET_DIRECTORY}/{path}")

            if args.operation == "verify":
                verify(read)
            else:
                with ZipFile(args.output, "w") as archive:
                    def copy(path):
                        data = read(path)
                        archive.writestr(ZipInfo(path), data, compress_type=ZIP_DEFLATED, compresslevel=6)
                        return data

                    verify(copy)


if __name__ == "__main__":
    main()
