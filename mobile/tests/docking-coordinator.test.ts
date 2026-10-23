import assert from "node:assert/strict";
import test from "node:test";

import { createGame } from "../src/game/engine.ts";
import {
  applyCoordinatorSample,
  consumeCompletedDocking,
  createDockingCoordinator,
  dockingViewModel,
  repairDockingCoordinatorForGame,
  reconcileDepartedDock,
  selectDockingTarget,
  type DockingCoordinator,
} from "../src/ui/dockingCoordinator.ts";

const TARGET = {
  id: "port-1",
  coords: { latitude: 39.7392, longitude: -104.9903 },
};

function sample(recordedAtMs: number, accuracy = 5) {
  return {
    latitude: TARGET.coords.latitude,
    longitude: TARGET.coords.longitude,
    horizontalAccuracyMeters: accuracy,
    altitudeMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
    speedMetersPerSecond: 0,
    recordedAtMs,
    isMocked: false,
  };
}

function complete(state: DockingCoordinator): DockingCoordinator {
  let next = applyCoordinatorSample(state, sample(0), 0);
  for (let at = 15_000; at <= 600_000; at += 15_000) {
    next = applyCoordinatorSample(next, sample(at), at);
  }
  return next;
}

test("selecting another port resets incomplete qualification and keeps no location trail", () => {
  let state = createDockingCoordinator(TARGET);
  state = applyCoordinatorSample(state, sample(0), 0);
  state = applyCoordinatorSample(state, sample(15_000), 15_000);
  state = selectDockingTarget(state, {
    id: "port-2",
    coords: { latitude: 40, longitude: -105 },
  });

  assert.equal(state.target.id, "port-2");
  assert.equal(state.session.portId, "port-2");
  assert.equal(state.session.qualifiedMs, 0);
  assert.equal(state.session.status, "armed");
  assert.equal("samples" in state, false);
});

test("view model exposes armed, qualifying countdown, poor signal, paused grace, completed, and departed", () => {
  let state = createDockingCoordinator(TARGET);
  assert.deepEqual(dockingViewModel(state, 0, false), {
    phase: "armed",
    headline: "APPROACH ARMED",
    detail: "Waiting for a qualifying location sample.",
    remainingMs: 600_000,
    foregroundOnly: false,
  });

  state = applyCoordinatorSample(state, sample(0), 0);
  state = applyCoordinatorSample(state, sample(15_000), 15_000);
  assert.equal(dockingViewModel(state, 15_000, true).phase, "qualifying");
  assert.equal(dockingViewModel(state, 15_000, true).remainingMs, 585_000);
  assert.equal(dockingViewModel(state, 15_000, true).foregroundOnly, true);

  state = applyCoordinatorSample(state, sample(20_000, 80), 20_000);
  assert.equal(dockingViewModel(state, 20_000, false).phase, "poor-signal");
  assert.match(dockingViewModel(state, 20_000, false).detail, /accuracy/i);

  state = applyCoordinatorSample(state, null, 25_000);
  assert.equal(dockingViewModel(state, 30_000, false).phase, "paused");
  assert.match(dockingViewModel(state, 30_000, false).detail, /20 seconds/i);

  state = complete(createDockingCoordinator(TARGET));
  assert.equal(dockingViewModel(state, 600_000, false).phase, "completed");
  state = consumeCompletedDocking(
    createGame({ origin: TARGET.coords, seed: "view-model-departure" }),
    state,
  ).coordinator;
  state = applyCoordinatorSample(state, null, 610_000);
  state = applyCoordinatorSample(state, null, 640_001);
  assert.equal(dockingViewModel(state, 640_001, false).phase, "departed");
});

test("completed proof docks exactly once and replay state survives coordinator calls", () => {
  const state = complete(createDockingCoordinator(TARGET));
  const game = createGame({ origin: TARGET.coords, seed: "coordinator-proof" });

  const first = consumeCompletedDocking(game, state);
  assert.equal(first.game.dockedPortId, TARGET.id);
  assert.equal(first.game.consumedDockingProofIds.length, 1);
  assert.equal(first.coordinator.proofConsumed, true);

  const second = consumeCompletedDocking(first.game, first.coordinator);
  assert.equal(second.game, first.game);
  assert.equal(second.game.consumedDockingProofIds.length, 1);
});

test("a restored consumed proof is acknowledged without attempting to dock again", () => {
  const state = complete(createDockingCoordinator(TARGET));
  const proof = state.session.proof!;
  const game = {
    ...createGame({ origin: TARGET.coords, seed: "restored-proof" }),
    consumedDockingProofIds: [proof.id],
    dockSequence: 1,
    dockedPortId: TARGET.id,
  };

  const result = consumeCompletedDocking(game, state);
  assert.equal(result.game, game);
  assert.equal(result.coordinator.proofConsumed, true);
});

test("departure after grace revokes game docking but does not mutate unrelated game progress", () => {
  let state = complete(createDockingCoordinator(TARGET));
  const docked = consumeCompletedDocking(
    createGame({ origin: TARGET.coords, seed: "departure" }),
    state,
  );
  state = applyCoordinatorSample(docked.coordinator, null, 610_000);
  state = applyCoordinatorSample(state, null, 640_001);

  const result = reconcileDepartedDock(docked.game, state);
  assert.equal(result.dockedPortId, null);
  assert.deepEqual(result.player, docked.game.player);
  assert.deepEqual(result.ports, docked.game.ports);
});

test("selecting another destination preserves current dock authorization while resetting approach", () => {
  const completed = complete(createDockingCoordinator(TARGET));
  const docked = consumeCompletedDocking(
    createGame({ origin: TARGET.coords, seed: "select-after-dock" }),
    completed,
  );

  const selected = selectDockingTarget(docked.coordinator, {
    id: "port-2",
    coords: { latitude: 39.75, longitude: -105 },
  });

  assert.equal(selected.target.id, "port-2");
  assert.equal(selected.session.status, "armed");
  assert.equal(selected.authorizedDock?.target.id, TARGET.id);
  assert.equal(reconcileDepartedDock(docked.game, selected), docked.game);
});

test("samples for a new target still apply departure grace to preserved dock authorization", () => {
  const completed = complete(createDockingCoordinator(TARGET));
  const docked = consumeCompletedDocking(
    createGame({ origin: TARGET.coords, seed: "depart-after-select" }),
    completed,
  );
  let selected = selectDockingTarget(docked.coordinator, {
    id: "port-2",
    coords: { latitude: 39.75, longitude: -105 },
  });
  selected = applyCoordinatorSample(selected, {
    ...sample(610_000),
    latitude: 39.75,
    longitude: -105,
  }, 610_000);
  selected = applyCoordinatorSample(selected, {
    ...sample(640_001),
    latitude: 39.75,
    longitude: -105,
  }, 640_001);

  assert.equal(reconcileDepartedDock(docked.game, selected).dockedPortId, null);
  assert.equal(dockingViewModel(selected, 640_001, false).phase, "qualifying");
});

test("a headless proof consumed after departure cannot authorize its market", () => {
  let state = complete(createDockingCoordinator(TARGET));
  state = applyCoordinatorSample(state, null, 600_001);
  state = applyCoordinatorSample(state, null, 630_002);
  const result = consumeCompletedDocking(
    createGame({ origin: TARGET.coords, seed: "headless-proof-survival" }),
    state,
  );

  assert.equal(result.game.dockedPortId, null);
  assert.equal(result.game.discoveredPortIds.includes(TARGET.id), true);
  assert.equal(result.game.revealedMarketIds.includes(TARGET.id), true);
  assert.equal(result.game.consumedDockingProofIds.length, 1);
  assert.equal(result.coordinator.proofConsumed, true);
  assert.equal(result.coordinator.authorizedDock, null);
});

test("boot repair reopens a proof marked consumed before its game save completed", () => {
  const completed = complete(createDockingCoordinator(TARGET));
  const prematurelyConsumed = consumeCompletedDocking(
    createGame({ origin: TARGET.coords, seed: "interrupted-handoff" }),
    completed,
  ).coordinator;
  const repaired = repairDockingCoordinatorForGame(
    createGame({ origin: TARGET.coords, seed: "interrupted-handoff" }),
    prematurelyConsumed,
  );

  assert.equal(repaired.proofConsumed, false);
  assert.equal(repaired.authorizedDock, null);
  assert.equal(
    consumeCompletedDocking(
      createGame({ origin: TARGET.coords, seed: "interrupted-handoff" }),
      repaired,
    ).game.dockedPortId,
    TARGET.id,
  );
});
