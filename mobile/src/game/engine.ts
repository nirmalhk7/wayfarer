import type { DockingProof } from "../docking.ts";

export type Coordinates = { latitude: number; longitude: number };
export type Commodity = { id: string; name: string; symbol: string; basePrice: number };
export type PriceBand = "cheap" | "steady" | "expensive";
export type MarketQuote = { commodityId: string; stock: number; ask: number; bid: number };
export type Starport = {
  id: string;
  name: string;
  callsign: string;
  position: Coordinates;
  market: MarketQuote[];
};
export type Encounter = {
  type: "pirates" | "customs" | "distress";
  severity: number;
  portId: string;
};
export type PlayerState = {
  credits: number;
  cargoCapacity: number;
  cargo: Record<string, number>;
  hull: number;
  maxHull: number;
};
export type GameState = {
  version: 1;
  seed: string;
  origin: Coordinates;
  ports: Starport[];
  dockedPortId: string | null;
  discoveredPortIds: string[];
  revealedMarketIds: string[];
  consumedDockingProofIds: string[];
  dockSequence: number;
  encounter: Encounter | null;
  player: PlayerState;
};

export const COMMODITIES: readonly Commodity[] = Object.freeze([
  { id: "ion_fuel", name: "Ion Fuel", symbol: "IF", basePrice: 42 },
  { id: "nutrient_gel", name: "Nutrient Gel", symbol: "NG", basePrice: 68 },
  { id: "salvaged_circuits", name: "Salvaged Circuits", symbol: "SC", basePrice: 126 },
  { id: "xeno_relics", name: "Xeno Relics", symbol: "XR", basePrice: 220 },
]);

const REMOTE_NAMES = [
  ["Cinder Exchange", "CND-04"],
  ["Lumen Reach", "LMN-17"],
  ["Vela Outpost", "VEL-09"],
  ["Morrow Terminal", "MRW-31"],
  ["Orchid Anchorage", "ORC-22"],
  ["Kepler Market", "KPL-08"],
] as const;
const EARTH_RADIUS_METERS = 6_371_000;
const UPGRADE_COST = { cargo: 320, hull: 380 } as const;
export const MAX_DOCKING_PROOF_ID_LENGTH = 96;
export const MAX_DOCKING_PROOF_HISTORY = 4_096;

function assertCoordinates(value: Coordinates): void {
  if (!Number.isFinite(value?.latitude) || !Number.isFinite(value?.longitude)) {
    throw new TypeError("Valid latitude and longitude required");
  }
}

function hash(text: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

function nextRandom(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let value = next;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { state: next, value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296 };
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function destination(origin: Coordinates, bearing: number, meters: number): Coordinates {
  const angularDistance = meters / EARTH_RADIUS_METERS;
  const latitude = radians(origin.latitude);
  const longitude = radians(origin.longitude);
  const resultLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const resultLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(resultLatitude),
  );
  return {
    latitude: resultLatitude * 180 / Math.PI,
    longitude: resultLongitude * 180 / Math.PI,
  };
}

function market(draw: () => number, portIndex: number): MarketQuote[] {
  return COMMODITIES.map((commodity, commodityIndex) => {
    const factor = 0.68 + draw() * 0.72;
    const ask = Math.max(8, Math.round(commodity.basePrice * factor) + portIndex * 2 - commodityIndex);
    return {
      commodityId: commodity.id,
      stock: 14 + Math.floor(draw() * 25),
      ask,
      bid: Math.max(1, Math.floor(ask * 0.76)),
    };
  });
}

function requirePort(game: GameState, portId: string): Starport {
  const port = game.ports.find((candidate) => candidate.id === portId);
  if (!port) throw new RangeError("Unknown starport");
  return port;
}

function cargoUnits(cargo: Record<string, number>): number {
  return Object.values(cargo).reduce((sum, quantity) => sum + quantity, 0);
}

export function isDockingProofId(id: string, portId: string): boolean {
  const prefix = `dock:${portId}:`;
  if (!id.startsWith(prefix)) return false;
  const suffix = id.slice(prefix.length);
  const [completedAt, sessionId, extra] = suffix.split(":");
  if (!/^(0|[1-9]\d*)$/.test(completedAt)) return false;
  const timestamp = Number(completedAt);
  if (!Number.isSafeInteger(timestamp) || String(timestamp) !== completedAt) return false;
  // Legacy v2 game saves predate session-scoped proof identifiers.
  return sessionId === undefined || (extra === undefined && /^[a-z0-9-]{1,64}$/.test(sessionId));
}

function validDockingProof(proof: DockingProof, portId: string): boolean {
  return typeof proof.id === "string"
    && proof.id.length > 0
    && proof.id.length <= MAX_DOCKING_PROOF_ID_LENGTH
    && Number.isSafeInteger(proof.completedAt)
    && proof.completedAt >= 0
    && typeof proof.sessionId === "string"
    && /^[a-z0-9-]{1,64}$/.test(proof.sessionId)
    && isDockingProofId(proof.id, portId)
    && proof.id === `dock:${portId}:${proof.completedAt}:${proof.sessionId}`;
}

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  assertCoordinates(a);
  assertCoordinates(b);
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const startLatitude = radians(a.latitude);
  const endLatitude = radians(b.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function createGame({ origin, seed = "wayfarer-mobile" }: {
  origin: Coordinates;
  seed?: string;
}): GameState {
  assertCoordinates(origin);
  let randomState = hash(`${seed}:${origin.latitude.toFixed(4)}:${origin.longitude.toFixed(4)}`);
  const draw = () => {
    const result = nextRandom(randomState);
    randomState = result.state;
    return result.value;
  };
  const freeport: Starport = {
    id: "port-0",
    name: "Wayfarer Freeport",
    callsign: "WFR-00",
    position: { ...origin },
    market: market(draw, 0),
  };
  const remotePorts = REMOTE_NAMES.map(([name, callsign], index): Starport => {
    const range = 300 + Math.floor(draw() * 1_201);
    const bearing = draw() * Math.PI * 2;
    return {
      id: `port-${index + 1}`,
      name,
      callsign,
      position: destination(origin, bearing, range),
      market: market(draw, index + 1),
    };
  });
  return {
    version: 1,
    seed,
    origin: { ...origin },
    ports: [freeport, ...remotePorts],
    dockedPortId: freeport.id,
    discoveredPortIds: [freeport.id],
    revealedMarketIds: [freeport.id],
    consumedDockingProofIds: [],
    dockSequence: 0,
    encounter: null,
    player: { credits: 900, cargoCapacity: 8, cargo: {}, hull: 3, maxHull: 3 },
  };
}

export function getRumors(game: GameState, portId: string): Array<{
  commodityId: string;
  commodityName: string;
  band: PriceBand;
}> {
  const port = requirePort(game, portId);
  return port.market.map((quote) => {
    const commodity = COMMODITIES.find((item) => item.id === quote.commodityId)!;
    const ratio = quote.ask / commodity.basePrice;
    return {
      commodityId: quote.commodityId,
      commodityName: commodity.name,
      band: ratio < 0.88 ? "cheap" : ratio > 1.14 ? "expensive" : "steady",
    };
  });
}

export function canDock(
  game: GameState,
  portId: string,
  position: Coordinates,
  radiusMeters = 120,
): boolean {
  if (radiusMeters < 0) throw new RangeError("Docking radius must be non-negative");
  return distanceMeters(requirePort(game, portId).position, position) <= radiusMeters;
}

function encounterFor(game: GameState, portId: string, dockSequence: number): Encounter | null {
  const value = nextRandom(hash(`${game.seed}:${portId}:encounter:${dockSequence}`)).value;
  if (value > 0.38) return null;
  const types: Encounter["type"][] = ["pirates", "customs", "distress"];
  return {
    type: types[Math.min(types.length - 1, Math.floor(value * types.length * 2))],
    severity: 1 + Math.floor(value * 3),
    portId,
  };
}

export function dock(
  game: GameState,
  portId: string,
  proof: DockingProof,
): GameState {
  requirePort(game, portId);
  if (!proof || proof.portId !== portId) throw new Error("Docking proof port does not match");
  if (!validDockingProof(proof, portId)) throw new Error("Valid docking proof required");
  if (game.consumedDockingProofIds.includes(proof.id)) throw new Error("Docking proof already used");
  if (game.consumedDockingProofIds.length >= MAX_DOCKING_PROOF_HISTORY) {
    throw new RangeError("Docking proof replay history is full");
  }
  const dockSequence = game.dockSequence + 1;
  return {
    ...game,
    dockedPortId: portId,
    discoveredPortIds: game.discoveredPortIds.includes(portId)
      ? [...game.discoveredPortIds]
      : [...game.discoveredPortIds, portId],
    revealedMarketIds: game.revealedMarketIds.includes(portId)
      ? [...game.revealedMarketIds]
      : [...game.revealedMarketIds, portId],
    consumedDockingProofIds: [...game.consumedDockingProofIds, proof.id],
    dockSequence,
    encounter: encounterFor(game, portId, dockSequence),
  };
}

export function revokeDocking(game: GameState): GameState {
  return { ...game, dockedPortId: null, encounter: null };
}

export function trade(game: GameState, order: {
  portId: string;
  commodityId: string;
  side: "buy" | "sell";
  quantity: number;
}): GameState {
  if (game.dockedPortId !== order.portId) throw new Error("Dock first to access this market");
  if (!Number.isInteger(order.quantity) || order.quantity <= 0) {
    throw new RangeError("Quantity must be a positive integer");
  }
  const port = requirePort(game, order.portId);
  const quote = port.market.find((item) => item.commodityId === order.commodityId);
  if (!quote) throw new RangeError("Unknown commodity");
  const cargo = { ...game.player.cargo };
  let credits = game.player.credits;
  let stock = quote.stock;
  let ask = quote.ask;
  let bid = quote.bid;

  if (order.side === "buy") {
    if (cargoUnits(cargo) + order.quantity > game.player.cargoCapacity) {
      throw new RangeError("Cargo hold has no room");
    }
    if (stock < order.quantity) throw new RangeError("Market lacks stock");
    const total = ask * order.quantity;
    if (credits < total) throw new RangeError("Insufficient credits");
    credits -= total;
    cargo[order.commodityId] = (cargo[order.commodityId] ?? 0) + order.quantity;
    stock -= order.quantity;
    ask += order.quantity * 2;
    bid = Math.max(1, Math.floor(ask * 0.76));
  } else {
    if ((cargo[order.commodityId] ?? 0) < order.quantity) {
      throw new RangeError("Not carrying enough cargo");
    }
    credits += bid * order.quantity;
    cargo[order.commodityId] -= order.quantity;
    if (cargo[order.commodityId] === 0) delete cargo[order.commodityId];
    stock += order.quantity;
    ask = Math.max(4, ask - order.quantity);
    bid = Math.max(1, Math.floor(ask * 0.76));
  }

  const updatedPort: Starport = {
    ...port,
    market: port.market.map((item) => item.commodityId === order.commodityId
      ? { ...item, stock, ask, bid }
      : { ...item }),
  };
  return {
    ...game,
    ports: game.ports.map((item) => item.id === updatedPort.id ? updatedPort : item),
    player: { ...game.player, credits, cargo },
  };
}

export function buyUpgrade(game: GameState, type: keyof typeof UPGRADE_COST): GameState {
  const cost = UPGRADE_COST[type];
  if (!cost) throw new RangeError("Unknown upgrade");
  if (game.player.credits < cost) throw new RangeError("Insufficient credits");
  return {
    ...game,
    player: {
      ...game.player,
      credits: game.player.credits - cost,
      cargoCapacity: type === "cargo" ? game.player.cargoCapacity + 4 : game.player.cargoCapacity,
      hull: type === "hull" ? game.player.hull + 1 : game.player.hull,
      maxHull: type === "hull" ? game.player.maxHull + 1 : game.player.maxHull,
    },
  };
}

export function resolveEncounter(
  game: GameState,
  choice: "run" | "pay" | "fight" | "help",
): GameState {
  if (!game.encounter) throw new Error("No active encounter");
  const player: PlayerState = { ...game.player, cargo: { ...game.player.cargo } };
  const severity = game.encounter.severity;
  if (choice === "run") {
    const commodityId = Object.keys(player.cargo)[0];
    if (commodityId) {
      const quantity = player.cargo[commodityId];
      const lost = Math.min(severity, Math.max(0, quantity - 1));
      player.cargo[commodityId] -= lost;
    } else {
      player.hull = Math.max(1, player.hull - 1);
    }
  } else if (choice === "pay") {
    player.credits = Math.max(0, player.credits - 35 * severity);
  } else if (choice === "fight") {
    player.hull = Math.max(1, player.hull - 1);
    player.credits += 30 * severity;
  } else if (choice === "help") {
    player.credits += 45 * severity;
  } else {
    throw new RangeError("Unknown encounter choice");
  }
  return { ...game, encounter: null, player };
}
