import assert from "node:assert/strict";
import test from "node:test";

import { DELIVERY, acceptDelivery, createGame, trade, type GameState } from "../src/game/engine.ts";
import {
  LEGACY_STORAGE_KEY,
  LIVE_STORAGE_KEY,
  TRAINING_STORAGE_KEY,
  decodeGameState,
  encodeGameState,
  migrateV1Save,
  storageKeyForMode,
} from "../src/persistence.ts";

const ORIGIN = { latitude: 39.7392, longitude: -104.9903 };

function game(seed = "persistence-test"): GameState {
  return createGame({ origin: ORIGIN, seed });
}

test("live and training campaigns use separate v2 storage keys", () => {
  assert.equal(LEGACY_STORAGE_KEY, "wayfarer.mobile.save.v1");
  assert.notEqual(LIVE_STORAGE_KEY, TRAINING_STORAGE_KEY);
  assert.match(LIVE_STORAGE_KEY, /live.*v2/i);
  assert.match(TRAINING_STORAGE_KEY, /training.*v2/i);
  assert.equal(storageKeyForMode("live"), LIVE_STORAGE_KEY);
  assert.equal(storageKeyForMode("training"), TRAINING_STORAGE_KEY);
});

test("v2 codec round-trips a valid game without persisting location history", () => {
  const state = {
    ...game(),
    locationHistory: [
      { latitude: 39.74, longitude: -104.99, capturedAt: "2026-08-12T12:00:00Z" },
    ],
  } as GameState & { locationHistory: unknown[] };

  const encoded = encodeGameState(state);
  const decoded = decodeGameState(encoded);

  assert.deepEqual(decoded, game());
  assert.equal(encoded.includes("locationHistory"), false);
  assert.equal(encoded.includes("capturedAt"), false);
});

test("v2 codec preserves docking proof replay state", () => {
  const state = {
    ...game("proof-state"),
    consumedDockingProofIds: ["dock:port-1:1000", "dock:port-2:2000"],
    dockSequence: 2,
  } as GameState;

  const decoded = decodeGameState(encodeGameState(state));

  assert.ok(decoded);
  assert.deepEqual(decoded.consumedDockingProofIds, ["dock:port-1:1000", "dock:port-2:2000"]);
  assert.equal(decoded.dockSequence, 2);
});

test("v2 codec rejects malformed docking proof replay records", () => {
  const base = game("invalid-proof-save");
  const invalidProofIds = [
    "proof-alpha",
    "dock:unknown-port:1000",
    "dock:port-1:-1",
    "dock:port-1:001000",
  ];

  for (const id of invalidProofIds) {
    assert.equal(
      decodeGameState(JSON.stringify({
        version: 2,
        game: { ...base, consumedDockingProofIds: [id], dockSequence: 1 },
      })),
      null,
    );
  }
});

test("v2 codec rejects oversized docking proof replay history", () => {
  const base = game("proof-history-cap");
  const consumedDockingProofIds = Array.from(
    { length: 4_097 },
    (_, index) => `dock:port-1:${index}`,
  );

  assert.equal(
    decodeGameState(JSON.stringify({
      version: 2,
      game: { ...base, consumedDockingProofIds, dockSequence: consumedDockingProofIds.length },
    })),
    null,
  );
});

test("v2 decoder refuses oversized raw saves before parsing them", () => {
  const oversized = JSON.stringify({
    version: 2,
    game: game("raw-save-cap"),
    ignoredPadding: "x".repeat(262_144),
  });

  assert.equal(decodeGameState(oversized), null);
});

test("decoder safely rejects absent, malformed, unsupported, and invalid v2 saves", () => {
  assert.equal(decodeGameState(null), null);
  assert.equal(decodeGameState("{"), null);
  assert.equal(decodeGameState(JSON.stringify({ version: 99, game: game() })), null);

  const invalidCases = [
    { ...game(), player: { ...game().player, credits: -1 } },
    { ...game(), player: { ...game().player, credits: null } },
    { ...game(), player: { ...game().player, cargo: { ion_fuel: -2 } } },
    { ...game(), player: { ...game().player, cargoCapacity: 3 } },
    { ...game(), player: { ...game().player, hull: 4, maxHull: 3 } },
    {
      ...game(),
      ports: game().ports.map((port, index) => index === 0
        ? { ...port, name: "Spoofed Freeport" }
        : port),
    },
    {
      ...game(),
      ports: game().ports.map((port, index) => index === 0
        ? { ...port, market: [{ ...port.market[0], ask: -4 }, ...port.market.slice(1)] }
        : port),
    },
    { ...game(), origin: { latitude: 91, longitude: ORIGIN.longitude } },
  ];

  for (const invalid of invalidCases) {
    assert.equal(
      decodeGameState(JSON.stringify({ version: 2, game: invalid })),
      null,
    );
  }
});

test("encoder refuses malformed runtime state instead of writing a corrupt save", () => {
  const malformed = {
    ...game(),
    player: { ...game().player, credits: Number.NaN },
  };

  assert.throws(() => encodeGameState(malformed), /valid game state/i);
});

test("v1 migration preserves valid campaign progress and clears transient legacy state", () => {
  const original = game("legacy-campaign");
  const tradedMarket = original.ports[2].market.map((quote, index) => index === 1
    ? { ...quote, stock: 7, ask: 211, bid: 160 }
    : quote);
  const legacy = {
    ...original,
    ports: original.ports.map((port, index) => index === 2
      ? { ...port, market: tradedMarket }
      : port),
    dockedPortId: "port-2",
    discoveredPortIds: ["port-0", "port-2"],
    revealedMarketIds: ["port-0", "port-2"],
    encounter: { type: "pirates", severity: 2, portId: "port-2" },
    player: {
      credits: 1_337,
      cargoCapacity: 12,
      cargo: { ion_fuel: 2, xeno_relics: 1 },
      hull: 3,
      maxHull: 4,
    },
    qualification: { status: "incomplete", answers: ["legacy"] },
    consumedDockingProofIds: ["legacy-proof"],
    dockSequence: 99,
    locationHistory: [{ latitude: 40, longitude: -105 }],
  };

  const migrated = migrateV1Save(legacy);

  assert.ok(migrated);
  assert.equal(migrated.seed, "legacy-campaign");
  assert.deepEqual(migrated.origin, ORIGIN);
  assert.equal(migrated.player.credits, 1_337);
  assert.equal(migrated.player.cargoCapacity, 12);
  assert.deepEqual(migrated.player.cargo, { ion_fuel: 2, xeno_relics: 1 });
  assert.equal(migrated.player.hull, 3);
  assert.equal(migrated.player.maxHull, 4);
  assert.deepEqual(migrated.ports[2].market, tradedMarket);
  assert.deepEqual(migrated.discoveredPortIds, ["port-0", "port-2"]);
  assert.deepEqual(migrated.revealedMarketIds, ["port-0", "port-2"]);
  assert.equal(migrated.dockedPortId, null);
  assert.equal(migrated.encounter, null);
  assert.deepEqual(migrated.consumedDockingProofIds, []);
  assert.equal(migrated.dockSequence, 0);
  assert.equal("qualification" in migrated, false);
  assert.equal("locationHistory" in migrated, false);
});

test("v1 migration drops invalid progress while retaining independently valid values", () => {
  const original = game("damaged-legacy");
  const legacy = {
    ...original,
    discoveredPortIds: ["port-0", "missing-port", "port-1", "port-1", 7],
    revealedMarketIds: ["port-0", "missing-port", "port-1"],
    ports: original.ports.map((port, index) => index === 1
      ? {
          ...port,
          market: port.market.map((quote, quoteIndex) => quoteIndex === 0
            ? { ...quote, stock: -1, ask: 0, bid: Number.NaN }
            : quoteIndex === 1
              ? { ...quote, stock: 9, ask: 101, bid: 76 }
              : quoteIndex === 2
                ? { ...quote, stock: 9, ask: 100, bid: 50 }
                : quote),
        }
      : port),
    player: {
      credits: -50,
      cargoCapacity: 10,
      cargo: { ion_fuel: 2, nutrient_gel: -1, made_up: 4 },
      hull: 8,
      maxHull: 4,
    },
  };

  const migrated = migrateV1Save(legacy);

  assert.ok(migrated);
  assert.equal(migrated.player.credits, 900);
  assert.equal(migrated.player.cargoCapacity, 8);
  assert.deepEqual(migrated.player.cargo, { ion_fuel: 2 });
  assert.equal(migrated.player.hull, 3);
  assert.equal(migrated.player.maxHull, 4);
  assert.deepEqual(migrated.discoveredPortIds, ["port-0", "port-1"]);
  assert.deepEqual(migrated.revealedMarketIds, ["port-0", "port-1"]);
  assert.deepEqual(migrated.ports[1].market[0], original.ports[1].market[0]);
  assert.deepEqual(migrated.ports[1].market[1], {
    ...original.ports[1].market[1],
    stock: 9,
    ask: 101,
    bid: 76,
  });
  assert.deepEqual(migrated.ports[1].market[2], original.ports[1].market[2]);
});

test("v1 migration rejects saves lacking trusted campaign identity", () => {
  assert.equal(migrateV1Save({ version: 1, seed: "", origin: ORIGIN }), null);
  assert.equal(migrateV1Save({ version: 1, seed: "legacy", origin: { latitude: NaN, longitude: 0 } }), null);
  assert.equal(migrateV1Save({ version: 2, seed: "legacy", origin: ORIGIN }), null);
});

test("decoder migrates a raw v1 save", () => {
  const legacy = {
    ...game("decoded-legacy"),
    player: { ...game("decoded-legacy").player, credits: 777 },
    dockedPortId: "port-3",
  };

  const decoded = decodeGameState(JSON.stringify(legacy));

  assert.ok(decoded);
  assert.equal(decoded.player.credits, 777);
  assert.equal(decoded.dockedPortId, null);
});

test("delivery save retains reserved fuel and rejects a reservation larger than its hold", () => {
  const state = game();
  const accepted = acceptDelivery(state);
  const loaded = trade(accepted, { portId: state.ports[0].id, commodityId: DELIVERY.commodityId, quantity: 2, side: "buy" });
  assert.deepEqual(decodeGameState(encodeGameState(loaded))?.delivery, { status: "active", loaded: 2 });
  assert.throws(() => encodeGameState({ ...loaded, player: { ...loaded.player, cargo: {}, cargoLots: {} } }), /valid game state/i);
});

test("v2 saves retain receipt, price anchor and cost lots and accept old cargo", () => {
  const state = game();
  const port = state.ports[0];
  const quote = port.market[0];
  const order = { portId: port.id, commodityId: quote.commodityId, quantity: 2 };
  state.player.cargo[quote.commodityId] = 1;
  const older = decodeGameState(encodeGameState(state));
  assert.equal(older?.player.cargoLots, undefined);
  const bought = trade(older!, { ...order, side: "buy" });
  assert.deepEqual(decodeGameState(encodeGameState(bought)), bought);
  const sold = trade(bought, { ...order, side: "sell" });
  assert.equal(sold.lastTrade?.costBasis, null);
  assert.deepEqual(decodeGameState(encodeGameState(sold)), sold);
  const invalid = { ...bought, lastTrade: { ...bought.lastTrade, portId: "unknown" } };
  assert.equal(decodeGameState(JSON.stringify({ version: 2, game: invalid })), null);
});
