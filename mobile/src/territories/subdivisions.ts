import type { Coordinates } from "../game/engine";
import pilot from "./cousub/pilot.json";
import catalog from "./cousub/catalog.json";
import crescent from "./cousub/0601590620.json";
import klamath from "./cousub/0601591490.json";
import smithRiver from "./cousub/0601593040.json";
import arcata from "./cousub/0602390100.json";
import eureka from "./cousub/0602390930.json";
import ferndale from "./cousub/0602390980.json";
import fortuna from "./cousub/0602391050.json";
import garberville from "./cousub/0602391100.json";
import northCoastal from "./cousub/0602392170.json";
import willowCreek from "./cousub/0602393745.json";

export const PILOT_PORTS = pilot;
export const SUBDIVISION_MAP_ID = catalog.revision;
export const FIX_MAX_AGE_MS = 30_000;
export const FIX_MAX_ACCURACY_M = 100;
export const BORDER_MARGIN_M = 35;

type Point = [number, number];
export type SubdivisionPort = typeof pilot[number];
const encoded: Record<string, string[][]> = {
  "0601590620": crescent, "0601591490": klamath, "0601593040": smithRiver,
  "0602390100": arcata, "0602390930": eureka, "0602390980": ferndale,
  "0602391050": fortuna, "0602391100": garberville, "0602392170": northCoastal,
  "0602393745": willowCreek,
};

function decodeRing(encodedRing: string): Point[] {
  let index = 0;
  function delta() {
    let value = 0;
    let shift = 0;
    let chunk: number;
    do {
      chunk = encodedRing.charCodeAt(index++) - 63;
      value += (chunk & 31) * 2 ** shift;
      shift += 5;
    } while (chunk >= 32 && index < encodedRing.length);
    return value % 2 ? -(value + 1) / 2 : value / 2;
  }

  let longitude = 0;
  let latitude = 0;
  const points: Point[] = [];
  while (index < encodedRing.length) {
    longitude += delta();
    latitude += delta();
    points.push([longitude / 1_000_000, latitude / 1_000_000]);
  }
  return points;
}

const geometryCache = new Map<string, Point[][][]>();
export function subdivisionGeometry(geoid: string): Point[][][] {
  const previous = geometryCache.get(geoid);
  if (previous) return previous;
  const geometry = encoded[geoid].map((polygon) => polygon.map(decodeRing));
  geometryCache.set(geoid, geometry);
  return geometry;
}

function ringLocation(ring: Point[], position: Coordinates, safeDistance: number) {
  // Conservative local metres/degree for this Northern California pilot.
  const scaleX = 110_000 * Math.cos((position.latitude + 0.1) * Math.PI / 180);
  const scaleY = 110_000;
  let inside = false;
  for (let index = 1; index < ring.length; index++) {
    const [ax, ay] = ring[index - 1];
    const [bx, by] = ring[index];
    const x = (ax - position.longitude) * scaleX;
    const y = (ay - position.latitude) * scaleY;
    const dx = (bx - ax) * scaleX;
    const dy = (by - ay) * scaleY;
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, -(x * dx + y * dy) / length2)) : 0;
    if ((x + t * dx) ** 2 + (y + t * dy) ** 2 <= safeDistance ** 2) return "border";
    if ((ay > position.latitude) !== (by > position.latitude) && x - dx * y / dy > 0) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

export function locateSubdivision(position: Coordinates, safetyRadius = BORDER_MARGIN_M) {
  let match: SubdivisionPort | null = null;
  const { longitude, latitude } = position;
  // Farther than the largest permitted uncertainty circle on every axis.
  const padding = safetyRadius / 70_000;
  for (const port of PILOT_PORTS) {
    const [west, south, east, north] = port.bounds;
    if (longitude < west - padding || longitude > east + padding || latitude < south - padding || latitude > north + padding) continue;
    for (const [outer, ...holes] of subdivisionGeometry(port.geoid)) {
      const shell = ringLocation(outer, position, safetyRadius);
      if (shell === "border") return { kind: "border" } as const;
      if (shell !== "inside") continue;
      const interiors = holes.map((ring) => ringLocation(ring, position, safetyRadius));
      if (interiors.includes("border")) return { kind: "border" } as const;
      if (interiors.includes("inside")) continue;
      if (match && match.geoid !== port.geoid) return { kind: "border" } as const;
      match = port;
    }
  }
  return match ? { kind: "inside", port: match } as const : { kind: "outside" } as const;
}

export type Observation = Coordinates & { timestamp: number; accuracy: number | null; mocked?: boolean };
export function assessObservation(fix: Observation, now: number) {
  if (!Number.isFinite(fix.timestamp) || fix.timestamp > now || now - fix.timestamp >= FIX_MAX_AGE_MS) {
    return { kind: "stale" } as const;
  }
  if (fix.mocked || fix.accuracy === null || !Number.isFinite(fix.accuracy)
    || fix.accuracy <= 0 || fix.accuracy > FIX_MAX_ACCURACY_M
    || !Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90
    || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180) {
    return { kind: "poor" } as const;
  }
  return locateSubdivision(fix, fix.accuracy + BORDER_MARGIN_M);
}
