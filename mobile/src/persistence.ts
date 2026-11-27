import {
  COMMODITIES,
  DELIVERY,
  askBounds,
  createGame,
  isDockingProofId,
  MAX_DOCKING_PROOF_HISTORY,
  type CargoLot,
  type DeliveryState,
  type Coordinates,
  type Encounter,
  type GameState,
  type MarketQuote,
  type PlayerState,
  type Starport,
  type TradeReceipt,
} from "./game/engine.ts";

import { createNorthCoastTraining, NORTH_COAST_MAP_ID } from "./territories/northCoast";

import { createSubdivisionCampaign } from "./game/subdivisionCampaign";
import { COUNTY_CAMPAIGN_ID, createCountyCampaign } from "./game/countyCampaign";
import { PORT_ID } from "./atlas/geometry";
import { SUBDIVISION_MAP_ID } from "./territories/subdivisions";

export const COUNTY_LIVE_STORAGE_KEY = "wayfarer.mobile.county-live.save.v1";
export const SUBDIVISION_LIVE_STORAGE_KEY = "wayfarer.mobile.cousub-live.save.v1";
export const LIVE_STORAGE_KEY = "wayfarer.mobile.live.save.v2";
export const TRAINING_STORAGE_KEY = "wayfarer.mobile.training.save.v2";
export const LEGACY_STORAGE_KEY = "wayfarer.mobile.save.v1";
export const LIVE_RESET_MARKER = "wayfarer:live-reset";

export type CampaignMode = "live" | "training";

type UnknownRecord = Record<string, unknown>;

const COMMODITY_IDS = new Set(COMMODITIES.map((commodity) => commodity.id));
const MAX_DOCKING_PROOF_ID_LENGTH = 96;
const MAX_SAVE_LENGTH = 256 * 1024;
const MAX_COUNTY_SAVE_LENGTH = 1_850_000;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function readCoordinates(value: unknown): Coordinates | null {
  if (!isRecord(value)) return null;
  const { latitude, longitude } = value;
  if (
    typeof latitude !== "number"
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || typeof longitude !== "number"
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function readMarketQuote(value: unknown): MarketQuote | null {
  if (!isRecord(value)) return null;
  const { commodityId, stock, ask, bid, referenceAsk } = value;
  if (
    !isNonEmptyString(commodityId)
    || !COMMODITY_IDS.has(commodityId)
    || !isNonNegativeInteger(stock)
    || !isPositiveInteger(ask)
    || !isPositiveInteger(bid)
    || bid !== Math.max(1, Math.floor(ask * 0.76))
  ) {
    return null;
  }
  const quote = { commodityId, stock, ask, bid };
  if (referenceAsk === undefined) return quote;
  if (!isPositiveInteger(referenceAsk)) return null;
  const bounds = askBounds(referenceAsk);
  return ask >= bounds.min && ask <= bounds.max ? { ...quote, referenceAsk } : null;
}

function readMarket(value: unknown): MarketQuote[] | null {
  if (!Array.isArray(value) || value.length !== COMMODITIES.length) return null;
  const quotes: MarketQuote[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const quote = readMarketQuote(candidate);
    if (!quote || seen.has(quote.commodityId)) return null;
    seen.add(quote.commodityId);
    quotes.push(quote);
  }
  if (COMMODITIES.some((commodity) => !seen.has(commodity.id))) return null;
  return quotes;
}

function readPort(value: unknown): Starport | null {
  if (!isRecord(value)) return null;
  const { id, name, callsign } = value;
  const position = readCoordinates(value.position);
  const market = readMarket(value.market);
  if (!isNonEmptyString(id) || !isNonEmptyString(name) || !isNonEmptyString(callsign) || !position || !market) {
    return null;
  }
  return { id, name, callsign, position, market };
}

function readCargo(value: unknown, capacity: number): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const cargo: Record<string, number> = {};
  let units = 0;
  for (const [commodityId, quantity] of Object.entries(value)) {
    if (!COMMODITY_IDS.has(commodityId) || !isPositiveInteger(quantity)) return null;
    units += quantity;
    if (!Number.isSafeInteger(units) || units > capacity) return null;
    cargo[commodityId] = quantity;
  }
  return cargo;
}

function readPlayer(value: unknown): PlayerState | null {
  if (!isRecord(value)) return null;
  const { credits, cargoCapacity, hull, maxHull } = value;
  if (
    !isNonNegativeInteger(credits)
    || !isPositiveInteger(cargoCapacity)
    || cargoCapacity < 8
    || (cargoCapacity - 8) % 4 !== 0
    || !isPositiveInteger(hull)
    || !isPositiveInteger(maxHull)
    || maxHull < 3
    || hull > maxHull
  ) {
    return null;
  }
  const cargo = readCargo(value.cargo, cargoCapacity);
  if (!cargo) return null;
  const player = { credits, cargoCapacity, cargo, hull, maxHull };
  if (value.cargoLots === undefined) return player;
  if (!isRecord(value.cargoLots)) return null;

  const cargoLots: Record<string, CargoLot[]> = {};
  for (const [id, lots] of Object.entries(value.cargoLots)) {
    if (!Object.hasOwn(cargo, id) || !Array.isArray(lots) || lots.length === 0) return null;
    let quantity = 0;
    let cost = 0;
    const validated: CargoLot[] = [];
    for (const lot of lots) {
      if (!isRecord(lot) || !isPositiveInteger(lot.quantity)
        || (lot.unitCost !== null && !isPositiveInteger(lot.unitCost))) return null;
      quantity += lot.quantity;
      cost += lot.quantity * (lot.unitCost ?? 0);
      if (quantity > cargo[id] || !Number.isSafeInteger(cost)) return null;
      validated.push({ quantity: lot.quantity, unitCost: lot.unitCost });
    }
    if (quantity !== cargo[id]) return null;
    cargoLots[id] = validated;
  }
  return { ...player, cargoLots };
}

function readTradeReceipt(value: unknown, knownPortIds: ReadonlySet<string>): TradeReceipt | null {
  if (!isRecord(value)) return null;
  const { portId, commodityId, side, quantity, unitPrice, costBasis } = value;
  if (typeof portId !== "string" || !knownPortIds.has(portId)
    || typeof commodityId !== "string" || !COMMODITY_IDS.has(commodityId)
    || (side !== "buy" && side !== "sell")
    || !isPositiveInteger(quantity) || !isPositiveInteger(unitPrice)
    || (costBasis !== null && !isPositiveInteger(costBasis))) return null;
  const total = quantity * unitPrice;
  if (!Number.isSafeInteger(total) || (side === "buy" && costBasis !== total)) return null;
  return { portId, commodityId, side, quantity, unitPrice, costBasis };
}

function readDelivery(value: unknown, player: PlayerState): DeliveryState | null {
  if (!isRecord(value) || !isNonNegativeInteger(value.loaded)) return null;
  if (value.status === "delivered" && value.loaded === 0) return { status: "delivered", loaded: 0 };
  if (value.status === "active"
    && value.loaded <= Math.min(DELIVERY.quantity, player.cargo[DELIVERY.commodityId] ?? 0)) {
    return { status: "active", loaded: value.loaded };
  }
  return null;
}

function readPortIds(value: unknown, knownPortIds: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !knownPortIds.has(candidate) || seen.has(candidate)) return null;
    seen.add(candidate);
    ids.push(candidate);
  }
  return ids;
}

function readDockingProofIds(value: unknown, knownPortIds: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_DOCKING_PROOF_HISTORY) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    let validPort = false;
    if (isNonEmptyString(candidate) && candidate.length <= MAX_DOCKING_PROOF_ID_LENGTH) {
      for (const portId of knownPortIds) {
        if (isDockingProofId(candidate, portId)) {
          validPort = true;
          break;
        }
      }
    }
    if (
      !isNonEmptyString(candidate)
      || candidate.length > MAX_DOCKING_PROOF_ID_LENGTH
      || seen.has(candidate)
      || !validPort
    ) {
      return null;
    }
    seen.add(candidate);
    ids.push(candidate);
  }
  return ids;
}

function readEncounter(value: unknown, knownPortIds: ReadonlySet<string>): Encounter | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { type, severity, portId } = value;
  if (
    (type !== "pirates" && type !== "customs" && type !== "distress")
    || !isPositiveInteger(severity)
    || severity > 3
    || typeof portId !== "string"
    || !knownPortIds.has(portId)
  ) {
    return undefined;
  }
  return { type, severity, portId };
}

function readGameState(value: unknown): GameState | null {
  if (!isRecord(value) || value.version !== 1 || !isNonEmptyString(value.seed)) return null;
  const origin = readCoordinates(value.origin);
  if (!origin || !Array.isArray(value.ports)) return null;

  const ports: Starport[] = [];
  const portIds = new Set<string>();
  for (const candidate of value.ports) {
    const port = readPort(candidate);
    if (!port || portIds.has(port.id)) return null;
    portIds.add(port.id);
    ports.push(port);
  }

  const { mapId } = value;
  const county = mapId === COUNTY_CAMPAIGN_ID;
  if (mapId !== undefined && mapId !== NORTH_COAST_MAP_ID && mapId !== SUBDIVISION_MAP_ID && !county) return null;
  let base: GameState;
  try {
    base = county ? createCountyCampaign() : mapId === SUBDIVISION_MAP_ID ? createSubdivisionCampaign()
      : mapId === NORTH_COAST_MAP_ID ? createNorthCoastTraining() : createGame({ origin, seed: value.seed });
  } catch {
    return null;
  }
  if (base.seed !== value.seed || base.origin.latitude !== origin.latitude || base.origin.longitude !== origin.longitude) {
    return null;
  }
  if (county) {
    if (ports.some((port) => !PORT_ID.test(port.id) || port.callsign !== port.id || port.name.length > 120
      || port.position.latitude !== origin.latitude || port.position.longitude !== origin.longitude)) return null;
  } else if (ports.length !== base.ports.length) return null;
  for (let index = 0; !county && index < ports.length; index += 1) {
    const port = ports[index];
    const expected = base.ports[index];
    if (
      port.id !== expected.id
      || port.name !== expected.name
      || port.callsign !== expected.callsign
      || port.position.latitude !== expected.position.latitude
      || port.position.longitude !== expected.position.longitude
    ) {
      return null;
    }
  }

  const dockedPortId = value.dockedPortId;
  if (dockedPortId !== null && (typeof dockedPortId !== "string" || !portIds.has(dockedPortId))) return null;
  const discoveredPortIds = readPortIds(value.discoveredPortIds, portIds);
  const revealedMarketIds = readPortIds(value.revealedMarketIds, portIds);
  const consumedDockingProofIds = readDockingProofIds(value.consumedDockingProofIds, portIds);
  const dockSequence = value.dockSequence;
  const encounter = readEncounter(value.encounter, portIds);
  const player = readPlayer(value.player);
  if (
    !discoveredPortIds
    || !revealedMarketIds
    || !consumedDockingProofIds
    || !isNonNegativeInteger(dockSequence)
    || dockSequence !== consumedDockingProofIds.length
    || encounter === undefined
    || !player
  ) {
    return null;
  }
  if (revealedMarketIds.some((id) => !discoveredPortIds.includes(id))) return null;
  if (county && (discoveredPortIds.length !== ports.length || revealedMarketIds.length !== ports.length)) return null;
  if (mapId === SUBDIVISION_MAP_ID || county) {
    // Authorization comes exclusively from a fresh fix, so it never survives a save.
    if (dockedPortId !== null || encounter !== null || dockSequence !== 0 || value.delivery !== undefined) return null;
  } else if (!discoveredPortIds.includes(base.ports[0].id) || !revealedMarketIds.includes(base.ports[0].id)) return null;
  if (
    dockedPortId !== null
    && (!discoveredPortIds.includes(dockedPortId) || !revealedMarketIds.includes(dockedPortId))
  ) {
    return null;
  }
  if (encounter && encounter.portId !== dockedPortId) return null;
  const lastTrade = readTradeReceipt(value.lastTrade, portIds);
  if (value.lastTrade !== undefined && (!lastTrade || !revealedMarketIds.includes(lastTrade.portId))) return null;
  const delivery = readDelivery(value.delivery, player);
  if (value.delivery !== undefined && !delivery) return null;

  return {
    version: 1,
    seed: value.seed,
    ...(base.mapId ? { mapId: base.mapId } : {}),
    origin,
    ports,
    dockedPortId,
    discoveredPortIds,
    revealedMarketIds,
    consumedDockingProofIds,
    dockSequence,
    encounter,
    ...(lastTrade ? { lastTrade } : {}),
    ...(delivery ? { delivery } : {}),
    player,
  };
}

function validUpgradeCapacity(value: unknown): value is number {
  return isPositiveInteger(value) && value >= 8 && (value - 8) % 4 === 0;
}

function migrateCargo(value: unknown, capacity: number): Record<string, number> {
  if (!isRecord(value)) return {};
  const cargo: Record<string, number> = {};
  let units = 0;
  for (const commodity of COMMODITIES) {
    const quantity = value[commodity.id];
    if (!isPositiveInteger(quantity)) continue;
    units += quantity;
    if (!Number.isSafeInteger(units) || units > capacity) return {};
    cargo[commodity.id] = quantity;
  }
  return cargo;
}

function migrateMarket(baseMarket: MarketQuote[], value: unknown): MarketQuote[] {
  if (!Array.isArray(value)) return baseMarket;
  const validQuotes = new Map<string, MarketQuote>();
  for (const candidate of value) {
    const quote = readMarketQuote(candidate);
    if (quote && !validQuotes.has(quote.commodityId)) validQuotes.set(quote.commodityId, quote);
  }
  return baseMarket.map((quote) => validQuotes.get(quote.commodityId) ?? quote);
}

function migratePortIds(value: unknown, baseId: string, knownPortIds: ReadonlySet<string>): string[] {
  const result = [baseId];
  if (!Array.isArray(value)) return result;
  for (const candidate of value) {
    if (typeof candidate === "string" && knownPortIds.has(candidate) && !result.includes(candidate)) {
      result.push(candidate);
    }
  }
  return result;
}

export function storageKeyForMode(mode: CampaignMode): string {
  return mode === "training" ? TRAINING_STORAGE_KEY : LIVE_STORAGE_KEY;
}

export function migrateV1Save(value: unknown): GameState | null {
  if (!isRecord(value) || value.version !== 1 || !isNonEmptyString(value.seed)) return null;
  const origin = readCoordinates(value.origin);
  if (!origin) return null;

  let base: GameState;
  try {
    base = createGame({ origin, seed: value.seed });
  } catch {
    return null;
  }

  const legacyPorts = Array.isArray(value.ports) ? value.ports : [];
  const ports = base.ports.map((port) => {
    const legacyPort = legacyPorts.find((candidate) => isRecord(candidate) && candidate.id === port.id);
    return legacyPort && isRecord(legacyPort)
      ? { ...port, market: migrateMarket(port.market, legacyPort.market) }
      : port;
  });
  const knownPortIds = new Set(ports.map((port) => port.id));
  const discoveredPortIds = migratePortIds(value.discoveredPortIds, ports[0].id, knownPortIds);
  const revealedMarketIds = migratePortIds(value.revealedMarketIds, ports[0].id, knownPortIds)
    .filter((portId) => discoveredPortIds.includes(portId));

  const legacyPlayer = isRecord(value.player) ? value.player : {};
  const credits = isNonNegativeInteger(legacyPlayer.credits) ? legacyPlayer.credits : base.player.credits;
  const cargoCapacity = validUpgradeCapacity(legacyPlayer.cargoCapacity)
    ? legacyPlayer.cargoCapacity
    : base.player.cargoCapacity;
  const maxHull = isPositiveInteger(legacyPlayer.maxHull) && legacyPlayer.maxHull >= base.player.maxHull
    ? legacyPlayer.maxHull
    : base.player.maxHull;
  const hull = isPositiveInteger(legacyPlayer.hull) && legacyPlayer.hull <= maxHull
    ? legacyPlayer.hull
    : base.player.hull;
  const cargo = migrateCargo(legacyPlayer.cargo, cargoCapacity);

  return {
    version: 1,
    seed: base.seed,
    origin: base.origin,
    ports,
    dockedPortId: null,
    discoveredPortIds,
    revealedMarketIds,
    consumedDockingProofIds: [],
    dockSequence: 0,
    encounter: null,
    player: { credits, cargoCapacity, cargo, hull, maxHull },
  };
}

export function encodeGameState(state: GameState): string {
  const game = readGameState(state);
  if (!game) throw new TypeError("Valid game state required");
  const raw = JSON.stringify({ version: 2, game });
  if (game.mapId === COUNTY_CAMPAIGN_ID && raw.length > MAX_COUNTY_SAVE_LENGTH) throw new RangeError("Live save is too large");
  return raw;
}

export function decodeGameState(raw: string | null | undefined, mode?: CampaignMode | "subdivision-live" | "county-live"): GameState | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > (mode === "county-live" ? MAX_COUNTY_SAVE_LENGTH : MAX_SAVE_LENGTH)) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.version === 1) return mode === "subdivision-live" || mode === "county-live" ? null : migrateV1Save(value);
  if (value.version !== 2) return null;
  const game = readGameState(value.game);
  if (mode === "county-live") return game?.mapId === COUNTY_CAMPAIGN_ID ? game : null;
  if (mode === "subdivision-live") return game?.mapId === SUBDIVISION_MAP_ID ? game : null;
  if ((mode === "live" && game?.mapId) || (mode === "training" && game?.mapId && game.mapId !== NORTH_COAST_MAP_ID)) return null;
  return game;
}
