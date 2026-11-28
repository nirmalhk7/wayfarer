import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createAtlasLoader } from "../src/atlas/loader";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function ring(points: number[][]) {
  const previous = [0, 0];
  let result = "";
  for (const [x, y] of points) {
    for (const [index, coordinate] of [x, y].entries()) {
      const scaled = Math.round(coordinate * 10_000_000);
      const delta = scaled - previous[index];
      previous[index] = scaled;
      let n = delta < 0 ? -delta * 2 - 1 : delta * 2;
      while (n >= 32) {
        result += String.fromCharCode(n % 32 + 95);
        n = Math.floor(n / 32);
      }
      result += String.fromCharCode(n + 63);
    }
  }
  return result;
}

function rectangle(id: string, name: string, bounds: number[]) {
  const [w, s, e, n] = bounds;
  return [id, name, bounds, [[ring([[w, s], [e, s], [e, n], [w, n], [w, s]])]]];
}

function synthetic() {
  const document = (tile: string, limits: number[], ports: unknown[]) =>
    JSON.stringify({ revision: "county2026-v1", tile, limits, ports });
  return {
    "-123_37": document("-123_37", [-123.25, 36.75, -121.75, 38.25], [
      rectangle("county:06081", "San Mateo", [-122.64, 37.1, -122.15, 37.708333]),
      rectangle("county:06075", "San Francisco", [-122.64, 37.708333, -122.15, 37.84]),
      rectangle("county:06001", "Alameda", [-122.14, 37.52, -121.75, 37.84]),
    ]),
    "-125_40": document("-125_40", [-125.25, 39.75, -123.75, 41.25], [
      rectangle("county:06023", "Humboldt", [-124.5, 40.25, -123.8, 41.2]),
    ]),
  };
}

export function atlasFixture() {
  const sourceDir = process.env.WAYFARER_ATLAS_TEST_DATA;
  const fallback: Record<string, string> = synthetic();
  const index = sourceDir ? readFileSync(join(sourceDir, "index.json"), "utf8") : JSON.stringify({
    revision: "county2026-v1", halo: .25, scale: 10_000_000,
    tiles: Object.fromEntries(Object.entries(fallback).map(([key, raw]) => [key, {
      bytes: Buffer.byteLength(raw), sha256: sha256(raw),
    }])),
  });
  const cache = new Map<string, string>();
  const paths: string[] = [];
  let offline = false;
  function create() {
    return createAtlasLoader({
      async read(key) { return cache.get(key) ?? null; },
      async write(key, value) { cache.set(key, value); },
      async hash(value) { return sha256(value); },
      async get(path) {
        paths.push(path);
        if (offline) throw new Error("Offline");
        if (path === "index.json") return index;
        if (sourceDir && path === "counties.json") return readFileSync(join(sourceDir, path), "utf8");
        if (sourceDir) return gunzipSync(readFileSync(join(sourceDir, path + ".gz"))).toString();
        const key = path.slice(6, -5);
        if (!fallback[key]) throw new Error("Missing region");
        return fallback[key];
      },
    }, sha256(index));
  }
  let loader = create();
  return {
    atlas: {
      load: (key: string) => loader.load(key),
      peek: (key: string) => loader.peek(key),
      ranksFor: (id: string) => loader.ranksFor(id),
    },
    paths,
    restart() { loader = create(); },
    offline(value: boolean) { offline = value; },
  };
}
