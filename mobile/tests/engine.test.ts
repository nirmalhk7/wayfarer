import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMODITIES,
  buyUpgrade,
  canDock,
  createGame,
  distanceMeters,
  dock,
  getRumors,
  revokeDocking,
  resolveEncounter,
  trade,
  type Coordinates,
  type GameState,
} from "../src/game/engine.ts";
import type { DockingProof } from "../src/docking.ts";

const ORIGIN: Coordinates = { latitude: 39.7392, longitude: -104.9903 };

function game(seed = "mobile-test"): GameState {
  return createGame({ origin: ORIGIN, seed });
}

function proof(portId: string, completedAt = 1_000): DockingProof {
  return {
    id: `dock:${portId}:${completedAt}:test-session`,
    portId,
    completedAt,
    sessionId: "test-session",
  };
}

test("new campaign starts at a real-position freeport with six destinations", () => {
  const state = game();
  assert.equal(state.ports.length, 7);
  assert.equal(state.ports[0].name, "Wayfarer Freeport");
  assert.deepEqual(state.ports[0].position, ORIGIN);
  assert.equal(state.dockedPortId, state.ports[0].id);
  assert.equal(state.player.credits, 900);
  assert.equal(state.player.cargoCapacity, 8);
  assert.equal(state.player.hull, 3);
  assert.deepEqual(state.consumedDockingProofIds, []);
  assert.equal(state.dockSequence, 0);
  assert.ok(canDock(state, state.ports[0].id, ORIGIN));
  assert.doesNotThrow(() => JSON.stringify(state));

  for (const port of state.ports.slice(1)) {
    const distance = distanceMeters(ORIGIN, port.position);
    assert.ok(distance >= 300 && distance <= 1_500, `${port.name}: ${distance}`);
  }
});

test("same seed and position create same campaign", () => {
  assert.deepEqual(game(), game());
});

test("news exposes only qualitative price bands before docking", () => {
  const state = game();
  const remote = state.ports[1];
  const rumors = getRumors(state, remote.id);

  assert.equal(rumors.length, COMMODITIES.length);
  assert.ok(rumors.every((rumor) => ["cheap", "steady", "expensive"].includes(rumor.band)));
  assert.ok(rumors.every((rumor) => !("price" in rumor)));
});

test("docking consumes a proof bound to the requested port", () => {
  const state = game();
  const remote = state.ports[1];
  const dockingProof = proof(remote.id);

  assert.throws(() => dock(state, remote.id, proof(state.ports[2].id)), /proof.*port/i);
  const docked = dock(state, remote.id, dockingProof);
  assert.equal(docked.dockedPortId, remote.id);
  assert.ok(docked.discoveredPortIds.includes(remote.id));
  assert.deepEqual(docked.consumedDockingProofIds, [dockingProof.id]);
  assert.equal(docked.dockSequence, 1);
  assert.equal(state.dockedPortId, state.ports[0].id);
});

test("docking rejects malformed or internally inconsistent proofs", () => {
  const state = game();
  const remote = state.ports[1];

  assert.throws(
    () => dock(state, remote.id, { id: "", portId: remote.id, completedAt: 1_000, sessionId: "test-session" }),
    /valid docking proof/i,
  );
  assert.throws(
    () => dock(state, remote.id, { id: `dock:${remote.id}:1000:test-session`, portId: remote.id, completedAt: -1, sessionId: "test-session" }),
    /valid docking proof/i,
  );
  assert.throws(
    () => dock(state, remote.id, { id: `dock:${remote.id}:999:test-session`, portId: remote.id, completedAt: 1_000, sessionId: "test-session" }),
    /valid docking proof/i,
  );
});

test("docking proof cannot be replayed", () => {
  const state = game();
  const remote = state.ports[1];
  const dockingProof = proof(remote.id);
  const docked = dock(state, remote.id, dockingProof);

  assert.throws(() => dock(docked, remote.id, dockingProof), /proof.*used/i);
  assert.equal(docked.dockSequence, 1);
});

test("docking refuses a proof once replay history reaches its save limit", () => {
  const state = game();
  const remote = state.ports[1];
  const consumedDockingProofIds = Array.from(
    { length: 4_096 },
    (_, index) => `dock:${remote.id}:${index}`,
  );
  const atHistoryLimit: GameState = {
    ...state,
    consumedDockingProofIds,
    dockSequence: consumedDockingProofIds.length,
  };

  assert.throws(
    () => dock(atHistoryLimit, remote.id, proof(remote.id, 9_999)),
    /replay history/i,
  );
});

test("successive dockings use monotonic sequence for encounter generation", () => {
  const state = game("sequence-test");
  const remote = state.ports[1];
  const first = dock(state, remote.id, proof(remote.id, 1_000));
  const departed = revokeDocking(first);
  const second = dock(departed, remote.id, proof(remote.id, 2_000));

  assert.equal(first.dockSequence, 1);
  assert.equal(first.encounter, null);
  assert.equal(second.dockSequence, 2);
  assert.deepEqual(second.encounter, { type: "customs", severity: 1, portId: remote.id });
});

test("revoking docking clears market access and active encounter", () => {
  const state = game();
  const departed = revokeDocking({
    ...state,
    encounter: { type: "pirates", severity: 2, portId: state.ports[0].id },
  });

  assert.equal(departed.dockedPortId, null);
  assert.equal(departed.encounter, null);
  assert.throws(
    () => trade(departed, {
      portId: state.ports[0].id,
      commodityId: state.ports[0].market[0].commodityId,
      side: "buy",
      quantity: 1,
    }),
    /dock first/i,
  );
  assert.equal(state.dockedPortId, state.ports[0].id);
});

test("buying cargo spends credits, uses hold space, and moves local price", () => {
  const state = game();
  const port = state.ports[0];
  const quote = port.market[0];
  const next = trade(state, {
    portId: port.id,
    commodityId: quote.commodityId,
    side: "buy",
    quantity: 2,
  });

  assert.equal(next.player.cargo[quote.commodityId], 2);
  assert.equal(next.player.credits, state.player.credits - quote.ask * 2);
  assert.equal(next.ports[0].market[0].stock, quote.stock - 2);
  assert.ok(next.ports[0].market[0].ask > quote.ask);
  assert.equal(state.player.cargo[quote.commodityId] ?? 0, 0);
});

test("same-port round trip cannot mint credits", () => {
  const state = game();
  const port = state.ports[0];
  const commodityId = port.market[0].commodityId;
  const bought = trade(state, { portId: port.id, commodityId, side: "buy", quantity: 1 });
  const sold = trade(bought, { portId: port.id, commodityId, side: "sell", quantity: 1 });
  assert.ok(sold.player.credits < state.player.credits);
});

test("trade rejects remote markets, hold overflow, and missing inventory", () => {
  const state = game();
  const local = state.ports[0];
  const remote = state.ports[1];
  const commodityId = local.market[0].commodityId;

  assert.throws(
    () => trade(state, { portId: remote.id, commodityId, side: "buy", quantity: 1 }),
    /dock first/i,
  );
  assert.throws(
    () => trade(state, { portId: local.id, commodityId, side: "buy", quantity: 9 }),
    /cargo hold/i,
  );
  assert.throws(
    () => trade(state, { portId: local.id, commodityId, side: "sell", quantity: 1 }),
    /not carrying/i,
  );
});

test("trade authorizes docked port, not currently selected port", () => {
  const state = game();
  const selectedRemote = state.ports[1];
  const commodityId = selectedRemote.market[0].commodityId;

  assert.throws(
    () => trade(state, { portId: selectedRemote.id, commodityId, side: "buy", quantity: 1 }),
    /dock first/i,
  );
  assert.equal(state.dockedPortId, state.ports[0].id);
});

test("cargo and hull upgrades consume credits and improve ship", () => {
  const state = game();
  const cargo = buyUpgrade(state, "cargo");
  const hull = buyUpgrade(cargo, "hull");
  assert.equal(cargo.player.cargoCapacity, state.player.cargoCapacity + 4);
  assert.equal(hull.player.hull, cargo.player.hull + 1);
  assert.ok(hull.player.credits < state.player.credits);
});

test("encounters resolve through choices without deleting an ordinary shipment", () => {
  const state: GameState = {
    ...game(),
    encounter: { type: "pirates", severity: 2, portId: "port-1" },
    player: { ...game().player, cargo: { ion_fuel: 3 }, credits: 400 },
  };
  const next = resolveEncounter(state, "run");
  assert.equal(next.encounter, null);
  assert.ok((next.player.cargo.ion_fuel ?? 0) >= 1);
  assert.ok(next.player.credits >= 0);
  assert.ok(next.player.hull >= 1);
});
