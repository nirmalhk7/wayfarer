import { createGame, type Coordinates, type GameState } from "../game/engine";
import dataset from "./north-coast.json";

export const territories = dataset.features;
export const NORTH_COAST_MAP_ID = dataset.revision;

// Fictional Training pins in the county interiors. They are never live port locations.
const trainingPins: Record<string, Coordinates> = {
  "WFR-00": { latitude: 40.78, longitude: -124.00 },
  "CND-04": { latitude: 41.75, longitude: -124.02 },
  "LMN-17": { latitude: 41.13, longitude: -123.77 },
  "VEL-09": { latitude: 41.58, longitude: -123.84 },
  "MRW-31": { latitude: 40.49, longitude: -124.09 },
  "ORC-22": { latitude: 41.88, longitude: -123.67 },
  "KPL-08": { latitude: 40.22, longitude: -123.70 },
};

export const NORTH_COAST_ORIGIN: Coordinates = trainingPins["WFR-00"];

export function createNorthCoastTraining(): GameState {
  // Keep the original Training prices and encounters while moving fictional ports.
  const game = createGame({
    origin: { latitude: 39.7392, longitude: -104.9903 },
    seed: "wayfarer-mobile-training-v2",
  });
  return {
    ...game,
    mapId: NORTH_COAST_MAP_ID,
    origin: { ...NORTH_COAST_ORIGIN },
    ports: game.ports.map((port) => ({ ...port, position: { ...trainingPins[port.callsign] } })),
  };
}

export function usesNorthCoastTrainingMap(game: GameState): boolean {
  return game.mapId === NORTH_COAST_MAP_ID;
}

const EDGE_TOLERANCE_DEGREES = 1e-9;

// An edge point stays unassigned, including where adjacent counties share a line.
function ringContains(ring: number[][], { longitude, latitude }: Coordinates): "edge" | "inside" | "outside" {
  let inside = false;
  for (let index = 1; index < ring.length; index++) {
    const [ax, ay] = ring[index - 1];
    const [bx, by] = ring[index];
    const dx = bx - ax;
    const dy = by - ay;
    const epsilon = EDGE_TOLERANCE_DEGREES;
    if ((dx || dy) && longitude >= Math.min(ax, bx) - epsilon && longitude <= Math.max(ax, bx) + epsilon
      && latitude >= Math.min(ay, by) - epsilon && latitude <= Math.max(ay, by) + epsilon
      && Math.abs((longitude - ax) * dy - (latitude - ay) * dx) <= epsilon * Math.hypot(dx, dy)) {
      return "edge";
    }
    if ((ay > latitude) !== (by > latitude) && longitude < ax + dx * (latitude - ay) / dy) {
      inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

export function territoryAt(position: Coordinates) {
  const { longitude, latitude } = position;
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180
    || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;

  let territory: (typeof territories)[number]["properties"] | null = null;
  for (const { geometry, properties } of territories) {
    for (const [outer, ...holes] of geometry.coordinates) {
      const shell = ringContains(outer, position);
      if (shell === "edge") return null;
      if (shell !== "inside") continue;
      const exclusions = holes.map((hole) => ringContains(hole, position));
      if (exclusions.includes("edge")) return null;
      if (exclusions.includes("inside")) continue;
      if (territory && territory.fips !== properties.fips) return null;
      territory = properties;
    }
  }
  return territory;
}
