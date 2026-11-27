import type { PriceBand } from "./engine";

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

export function rumorSummary(commodityName: string, band: PriceBand): string {
  const suffix = band === "cheap" ? "SUPPLY GLUT" : band === "expensive" ? "SHORTAGE" : "STEADY";
  return `${commodityName.toUpperCase()} ${suffix}`;
}
