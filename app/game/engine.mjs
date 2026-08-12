/** Tradeable goods shared by every starport market. */
export const COMMODITIES = Object.freeze([
  { id: "fuel", name: "Ion Fuel", basePrice: 35 },
  { id: "rations", name: "Nebula Rations", basePrice: 60 },
  { id: "circuits", name: "Salvaged Circuits", basePrice: 110 },
  { id: "relics", name: "Sunken Relics", basePrice: 180 },
]);

const EARTH_RADIUS_METERS = 6_371_000;
const PORT_NAMES = [
  "Wayfarer Freeport",
  "Lumen Reach",
  "Cinder Exchange",
  "Vela Outpost",
  "Morrow Terminal",
  "Orchid Anchorage",
  "Kepler Market",
];
const UPGRADE_COSTS = { cargo: 250, hull: 300 };

/** @param {unknown} value @param {string} label */
function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
}

/** @param {{ latitude: number, longitude: number }} position */
function assertPosition(position) {
  assertFiniteNumber(position?.latitude, "latitude");
  assertFiniteNumber(position?.longitude, "longitude");
}

/** @param {string | number | undefined} seed */
function hashSeed(seed) {
  const text = String(seed ?? "wayfarer");
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** @param {number} state */
function randomFrom(state) {
  let next = state >>> 0;
  next += 0x6d2b79f5;
  let value = next;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { state: next >>> 0, value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296 };
}

/** @param {number} degrees */
function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Return geodesic distance between two latitude/longitude coordinates in meters.
 * @param {{ latitude: number, longitude: number }} a
 * @param {{ latitude: number, longitude: number }} b
 * @returns {number}
 */
export function distanceMeters(a, b) {
  assertPosition(a);
  assertPosition(b);
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const startLatitude = radians(a.latitude);
  const endLatitude = radians(b.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

/** @param {{ latitude: number, longitude: number }} origin @param {number} bearing @param {number} meters */
function offsetPosition(origin, bearing, meters) {
  const angularDistance = meters / EARTH_RADIUS_METERS;
  const latitude = radians(origin.latitude);
  const longitude = radians(origin.longitude);
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );
  return {
    latitude: (destinationLatitude * 180) / Math.PI,
    longitude: (destinationLongitude * 180) / Math.PI,
  };
}

/** @param {ReturnType<typeof createGame>} game @param {string} portId */
function requirePort(game, portId) {
  const port = game.ports.find((candidate) => candidate.id === portId);
  if (!port) throw new RangeError(`Unknown port: ${portId}`);
  return port;
}

/** @param {Record<string, number>} cargo */
function cargoUnits(cargo) {
  return Object.values(cargo).reduce((total, quantity) => total + quantity, 0);
}

/**
 * Create a deterministic, local game map without storing any external location data.
 * @param {{ latitude: number, longitude: number, seed?: string | number }} options
 * @returns {object} Serializable game state; callers receive a new state from every mutator.
 */
export function createGame({ latitude, longitude, seed } = {}) {
  const origin = { latitude, longitude };
  assertPosition(origin);
  let state = hashSeed(seed ?? `${latitude},${longitude}`);
  const draw = () => {
    const random = randomFrom(state);
    state = random.state;
    return random.value;
  };
  const ports = PORT_NAMES.map((name, index) => {
    const distance = index === 0 ? 0 : 250 + Math.floor(draw() * 951);
    const bearing = index === 0 ? 0 : draw() * Math.PI * 2;
    const market = COMMODITIES.map((commodity, commodityIndex) => {
      const priceFactor = 0.72 + draw() * 0.62;
      return {
        commodityId: commodity.id,
        stock: 18 + Math.floor(draw() * 18),
        price: Math.max(5, Math.round(commodity.basePrice * priceFactor) + index * 2 - commodityIndex),
      };
    });
    return {
      id: `port-${index + 1}`,
      name,
      position: index === 0 ? { ...origin } : offsetPosition(origin, bearing, distance),
      market,
    };
  });
  const originPortId = ports[0].id;
  return {
    origin,
    seed: String(seed ?? `${latitude},${longitude}`),
    originPortId,
    ports,
    discoveredPortIds: [originPortId],
    revealedMarkets: { [originPortId]: true },
    dockedPortId: originPortId,
    encounter: null,
    player: { credits: 900, cargoCapacity: 8, cargo: {}, hull: 1 },
  };
}

/**
 * Return price bands for a port without exposing numeric prices or inventory.
 * @param {ReturnType<typeof createGame>} game
 * @param {string} portId
 * @returns {{ commodityId: string, commodityName: string, price: "cheap" | "fair" | "expensive" }[]}
 */
export function getRumors(game, portId) {
  const port = requirePort(game, portId);
  return port.market.map((entry) => {
    const commodity = COMMODITIES.find((candidate) => candidate.id === entry.commodityId);
    const ratio = entry.price / commodity.basePrice;
    return {
      commodityId: entry.commodityId,
      commodityName: commodity.name,
      price: ratio < 0.9 ? "cheap" : ratio > 1.12 ? "expensive" : "fair",
    };
  });
}

/**
 * Whether a player location is close enough to dock at a known port.
 * @param {ReturnType<typeof createGame>} game
 * @param {string} portId
 * @param {{ latitude: number, longitude: number }} position
 * @param {number} [radiusMeters=120]
 * @returns {boolean}
 */
export function canDock(game, portId, position, radiusMeters = 120) {
  if (!(radiusMeters >= 0)) throw new RangeError("radiusMeters must be non-negative");
  const port = requirePort(game, portId);
  return distanceMeters(port.position, position) <= radiusMeters;
}

/** @param {ReturnType<typeof createGame>} game @param {string} portId */
function encounterForDock(game, portId) {
  const result = randomFrom(hashSeed(`${game.seed}:${portId}:encounter`));
  if (result.value >= 0.35) return null;
  const kinds = ["pirates", "distress", "debris"];
  return {
    type: kinds[Math.floor(result.value * kinds.length) % kinds.length],
    severity: 1 + Math.floor(result.value * 3),
    portId,
  };
}

/**
 * Dock at a nearby starport. `demo` permits location simulation for a demo build.
 * @param {ReturnType<typeof createGame>} game
 * @param {string} portId
 * @param {{ latitude: number, longitude: number }} position
 * @param {{ demo?: boolean }} [options]
 * @returns {object} A new game state with the market revealed, and possibly an encounter.
 */
export function dock(game, portId, position, { demo = false } = {}) {
  requirePort(game, portId);
  if (!demo && !canDock(game, portId, position)) throw new RangeError("Too far away to dock");
  const encounter = encounterForDock(game, portId);
  return {
    ...game,
    dockedPortId: portId,
    discoveredPortIds: game.discoveredPortIds.includes(portId)
      ? [...game.discoveredPortIds]
      : [...game.discoveredPortIds, portId],
    revealedMarkets: { ...game.revealedMarkets, [portId]: true },
    encounter,
  };
}

/** @param {ReturnType<typeof createGame>} game @param {string} portId @param {string} commodityId */
function requireMarketEntry(game, portId, commodityId) {
  const port = requirePort(game, portId);
  const entry = port.market.find((candidate) => candidate.commodityId === commodityId);
  if (!entry) throw new RangeError(`Unknown commodity: ${commodityId}`);
  return { port, entry };
}

/**
 * Buy at the listed ask or sell at the port's discounted bid for an integral quantity.
 * @param {ReturnType<typeof createGame>} game
 * @param {{ portId: string, commodityId: string, side: "buy" | "sell", quantity: number }} order
 * @returns {object} A new game state after the completed trade.
 */
export function trade(game, { portId, commodityId, side, quantity }) {
  if (game.dockedPortId !== portId) throw new Error("You must be docked at this port to trade");
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("quantity must be a positive integer");
  if (side !== "buy" && side !== "sell") throw new RangeError("side must be buy or sell");
  const { port, entry } = requireMarketEntry(game, portId, commodityId);
  const cargo = { ...game.player.cargo };
  const totalCargo = cargoUnits(cargo);
  let credits = game.player.credits;
  let stock = entry.stock;
  let price = entry.price;

  if (side === "buy") {
    if (stock < quantity) throw new RangeError("Not enough stock at this port");
    if (totalCargo + quantity > game.player.cargoCapacity) throw new RangeError("Not enough cargo capacity");
    const cost = price * quantity;
    if (credits < cost) throw new RangeError("Not enough credits");
    credits -= cost;
    cargo[commodityId] = (cargo[commodityId] ?? 0) + quantity;
    stock -= quantity;
    price += quantity;
  } else {
    if ((cargo[commodityId] ?? 0) < quantity) throw new RangeError("Not enough cargo to sell");
    const sellPrice = Math.max(1, Math.floor(price * 0.7));
    credits += sellPrice * quantity;
    cargo[commodityId] -= quantity;
    if (cargo[commodityId] === 0) delete cargo[commodityId];
    stock += quantity;
    price = Math.max(1, price - quantity);
  }

  const updatedPort = {
    ...port,
    market: port.market.map((candidate) => candidate.commodityId === commodityId
      ? { ...candidate, stock, price }
      : { ...candidate }),
  };
  return {
    ...game,
    ports: game.ports.map((candidate) => candidate.id === portId ? updatedPort : candidate),
    player: { ...game.player, credits, cargo },
  };
}

/**
 * Purchase a permanent cargo or hull upgrade.
 * @param {ReturnType<typeof createGame>} game
 * @param {"cargo" | "hull"} type
 * @returns {object} A new game state after paying for the selected upgrade.
 */
export function buyUpgrade(game, type) {
  if (!Object.hasOwn(UPGRADE_COSTS, type)) throw new RangeError(`Unknown upgrade: ${type}`);
  const cost = UPGRADE_COSTS[type];
  if (game.player.credits < cost) throw new RangeError("Not enough credits for upgrade");
  return {
    ...game,
    player: {
      ...game.player,
      credits: game.player.credits - cost,
      cargoCapacity: type === "cargo" ? game.player.cargoCapacity + 4 : game.player.cargoCapacity,
      hull: type === "hull" ? game.player.hull + 1 : game.player.hull,
    },
  };
}

/**
 * Resolve the active encounter with a non-catastrophic choice.
 * @param {ReturnType<typeof createGame>} game
 * @param {"run" | "pay" | "fight" | "help"} choice
 * @returns {object} A new game state with a cleared encounter and partial consequence.
 */
export function resolveEncounter(game, choice) {
  if (!game.encounter) throw new Error("No encounter to resolve");
  const player = { ...game.player, cargo: { ...game.player.cargo } };
  const severity = game.encounter.severity;
  if (choice === "run") {
    const commodityId = Object.keys(player.cargo)[0];
    if (commodityId) {
      const lost = Math.min(severity, Math.max(0, player.cargo[commodityId] - 1));
      player.cargo[commodityId] -= lost;
      if (player.cargo[commodityId] === 0) delete player.cargo[commodityId];
    }
  } else if (choice === "pay") {
    player.credits -= Math.min(player.credits, 25 * severity);
  } else if (choice === "fight") {
    player.hull = Math.max(1, player.hull - 1);
    player.credits += 20 * severity;
  } else if (choice === "help") {
    player.credits += 30 * severity;
  } else {
    throw new RangeError("Unknown encounter choice");
  }
  return { ...game, player, encounter: null };
}
