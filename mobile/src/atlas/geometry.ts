import { compassDirection, nearestBoundaryPoint, type CompassDirection } from "../game/compass";
import type { Coordinates } from "../game/engine";
import { ringLocation } from "../territories/subdivisions";

export const ATLAS_REVISION = "county2026-v1";
export const MAX_TILE_BYTES = 12_000_000;
export const PORT_ID = /^county:\d{5}$/;
export const TILE_ID = /^-?\d{1,3}_-?\d{1,2}$/;
const SCALE = 10_000_000;
const HALO = .25;
type Point = [number, number];
type Bounds = [number, number, number, number];
export type AtlasPort = { id: string; name: string };
type Geometry = { port: AtlasPort; limits: Bounds; polygons: Point[][][] };
export type AtlasTile = { limits: Bounds; ports: Geometry[] };

export function wrapLongitude(longitude: number): number {
  return longitude >= -180 && longitude < 180 ? longitude
    : ((longitude + 180) % 360 + 360) % 360 - 180;
}

export function tileKey(position: Coordinates) {
  return Math.floor(wrapLongitude(position.longitude)) + "_" + Math.min(89, Math.floor(position.latitude));
}

function decodeRing(encoded: string): Point[] {
  let index = 0;
  function readDelta() {
    let value = 0;
    for (let factor = 1; factor <= 32 ** 7 && index < encoded.length; factor *= 32) {
      const chunk = encoded.charCodeAt(index++) - 63;
      if (chunk < 0 || chunk > 63) break;
      value += (chunk % 32) * factor;
      if (chunk < 32) return value % 2 ? -(value + 1) / 2 : value / 2;
    }
    throw new RangeError("Invalid boundary encoding");
  }
  let x = 0;
  let y = 0;
  const ring: Point[] = [];
  while (index < encoded.length) {
    x += readDelta();
    y += readDelta();
    if (Math.abs(x) > 181 * SCALE || Math.abs(y) > 91 * SCALE) throw new RangeError("Invalid boundary point");
    ring.push([x / SCALE, y / SCALE]);
  }
  if (ring.length < 4 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) {
    throw new RangeError("Invalid boundary ring");
  }
  return ring;
}

function bounds(value: unknown): value is Bounds {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] <= value[2] && value[1] <= value[3];
}

export function decodeTile(raw: string, key: string): AtlasTile {
  const value = JSON.parse(raw);
  const [x, y] = key.split("_").map(Number);
  const limits: Bounds = [x - HALO, y - HALO, x + 1 + HALO, y + 1 + HALO];
  if (!value || value.revision !== ATLAS_REVISION || value.tile !== key
    || !bounds(value.limits) || !limits.every((point, i) => point === value.limits[i]) || !Array.isArray(value.ports)) {
    throw new Error("Wrong port data version");
  }
  const seen = new Set<string>();
  const ports = value.ports.map((row: unknown): Geometry => {
    if (!Array.isArray(row) || row.length !== 4) throw new Error("Invalid port record");
    const [id, name, boundsValue, polygons] = row;
    if (typeof id !== "string" || !PORT_ID.test(id) || seen.has(id)
      || typeof name !== "string" || !name.trim() || !bounds(boundsValue)
      || !Array.isArray(polygons) || !polygons.length) throw new Error("Invalid port geometry");
    seen.add(id);
    return {
      port: { id, name }, limits: boundsValue,
      polygons: polygons.map((polygon: unknown) => {
        if (!Array.isArray(polygon) || !polygon.length) throw new Error("Invalid port polygon");
        return polygon.map((ring: unknown) => {
          if (typeof ring !== "string") throw new Error("Invalid boundary ring");
          return decodeRing(ring);
        });
      }),
    };
  });
  return { limits, ports };
}

export function resolvePort(tile: AtlasTile, position: Coordinates, radius: number) {
  const { latitude } = position;
  const longitude = wrapLongitude(position.longitude);
  const point = { latitude, longitude };
  // A query is valid only in this tile's core. The .25° halo prevents a
  // rounded clipping edge from becoming a confidence boundary.
  if (tileKey(point) !== (tile.limits[0] + HALO) + "_" + (tile.limits[1] + HALO)) {
    return { kind: "outside" } as const;
  }
  const padding = radius / 30_000;
  let match: AtlasPort | undefined;
  for (const { port, limits: [west, south, east, north], polygons } of tile.ports) {
    if (longitude < west - padding || longitude > east + padding
      || latitude < south - padding || latitude > north + padding) continue;
    for (const [outer, ...holes] of polygons) {
      const shell = ringLocation(outer, point, radius);
      if (shell === "border") return { kind: "border" } as const;
      if (shell !== "inside") continue;
      const inner = holes.map((ring) => ringLocation(ring, point, radius));
      if (inner.includes("border")) return { kind: "border" } as const;
      if (inner.includes("inside")) continue;
      if (match && match.id !== port.id) return { kind: "border" } as const;
      match = port;
    }
  }
  return match ? { kind: "inside", port: match } as const : { kind: "outside" } as const;
}

export function nearbyPorts(tile: AtlasTile, position: Coordinates, currentId?: string) {
  const from = { ...position, longitude: wrapLongitude(position.longitude) };
  const [west, south, east, north] = tile.limits;
  const longitudeMargin = Math.min(from.longitude - west, east - from.longitude);
  const latitudeMargin = Math.min(from.latitude - south, north - from.latitude);
  const longitudeScale = Math.cos((Math.abs(from.latitude) + 1.5) * Math.PI / 180);
  const verifiedRange = 110_000 * Math.min(latitudeMargin, longitudeMargin * longitudeScale);
  const readings: (AtlasPort & { current?: boolean; direction?: CompassDirection })[] = [];
  for (const { port, polygons } of tile.ports) {
    const current = port.id === currentId;
    if (current) {
      readings.push({ ...port, current });
      continue;
    }
    const closest = nearestBoundaryPoint(from, polygons, (a, b) =>
      !((a[0] === b[0] && (a[0] === west || a[0] === east))
        || (a[1] === b[1] && (a[1] === south || a[1] === north))));
    if (!closest) continue;
    const direction = compassDirection(from, { ...closest, longitude: wrapLongitude(closest.longitude) });
    if (direction.meters < verifiedRange) readings.push({ ...port, direction });
  }
  return readings.sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current))
    || (a.direction?.meters ?? Infinity) - (b.direction?.meters ?? Infinity)
    || a.id.localeCompare(b.id)).slice(0, 12);
}
