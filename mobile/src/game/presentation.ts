import type { Coordinates, PriceBand } from "./engine";

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "UNKNOWN";
  if (meters < 1) return "HERE";
  if (meters < 1_000) return `${Math.round(meters)} M`;
  return `${(meters / 1_000).toFixed(1)} KM`;
}

export function cargoUnits(cargo: Record<string, number>): number {
  return Object.values(cargo).reduce(
    (sum, quantity) => sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0),
    0,
  );
}

export function chartPosition(origin: Coordinates, destination: Coordinates): {
  x: number;
  y: number;
} {
  const longitudeScale = Math.cos(origin.latitude * Math.PI / 180);
  const xOffset = (destination.longitude - origin.longitude) * longitudeScale;
  const yOffset = destination.latitude - origin.latitude;
  const scale = Math.max(Math.abs(xOffset), Math.abs(yOffset), 0.0001);
  const x = 50 + (xOffset / scale) * 36;
  const y = 50 - (yOffset / scale) * 36;
  return {
    x: Math.max(8, Math.min(92, x)),
    y: Math.max(8, Math.min(92, y)),
  };
}

export function rumorSummary(commodityName: string, band: PriceBand): string {
  const suffix = band === "cheap" ? "SUPPLY GLUT" : band === "expensive" ? "SHORTAGE" : "STEADY";
  return `${commodityName.toUpperCase()} ${suffix}`;
}
