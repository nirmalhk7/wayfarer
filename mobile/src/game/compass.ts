import { distanceMeters, type Coordinates } from "./engine";

const radians = Math.PI / 180;
const directions = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"];

export function placeName(name: string): string {
  // The pilot source appends these designations. Keep the source names in saved data.
  return name.replace(/\s+(?:CCD|County)$/u, "");
}

export function trueBearing(from: Coordinates, to: Coordinates): number {
  const a = from.latitude * radians;
  const b = to.latitude * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const y = Math.sin(longitudeDelta) * Math.cos(b);
  const x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

type Point = [longitude: number, latitude: number];

export function nearestBoundaryPoint(from: Coordinates, polygons: Point[][][]): Coordinates;
export function nearestBoundaryPoint(from: Coordinates, polygons: Point[][][], include: (a: Point, b: Point) => boolean): Coordinates | undefined;
export function nearestBoundaryPoint(from: Coordinates, polygons: Point[][][], include?: (a: Point, b: Point) => boolean) {
  // A local latitude-adjusted plane determines the closest point on each short edge.
  // The displayed range and heading use the great circle to the winning point.
  const longitudeScale = Math.cos(from.latitude * radians);
  let nearest: Coordinates | undefined;
  let best = Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let index = 1; index < ring.length; index++) {
        if (include && !include(ring[index - 1], ring[index])) continue;
        const [aLongitude, aLatitude] = ring[index - 1];
        const [bLongitude, bLatitude] = ring[index];
        const dx = (bLongitude - aLongitude) * longitudeScale;
        const dy = bLatitude - aLatitude;
        const x = (from.longitude - aLongitude) * longitudeScale;
        const y = from.latitude - aLatitude;
        const length2 = dx * dx + dy * dy;
        const fraction = length2 ? Math.max(0, Math.min(1, (x * dx + y * dy) / length2)) : 0;
        const distance2 = (x - fraction * dx) ** 2 + (y - fraction * dy) ** 2;
        if (distance2 < best) {
          best = distance2;
          nearest = {
            latitude: aLatitude + fraction * (bLatitude - aLatitude),
            longitude: aLongitude + fraction * (bLongitude - aLongitude),
          };
        }
      }
    }
  }
  if (!nearest && !include) throw new RangeError("A port boundary must have a segment");
  return nearest;
}

export type CompassDirection = { meters: number; bearing: number | null };

export function compassDirection(from: Coordinates, to: Coordinates): CompassDirection {
  const meters = distanceMeters(from, to);
  return { meters, bearing: meters >= 1 ? trueBearing(from, to) : null };
}

export function compassRange(direction: CompassDirection): string {
  const { meters, bearing } = direction;
  const distance = meters < 1 ? "Less than 1 m"
    : meters < 1_000 ? Math.round(meters) + " m" : (meters / 1_000).toFixed(1) + " km";
  if (bearing === null) return distance;
  const sector = directions[Math.round(bearing / 45) % directions.length];
  return distance + " · " + sector + " " + (Math.round(bearing) % 360) + "° true";
}
