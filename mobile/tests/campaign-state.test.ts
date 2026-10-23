import assert from "node:assert/strict";
import test from "node:test";

import { createGame, type GameState } from "../src/game/engine.ts";
import {
  activeDockedPort,
  createLatestWriteQueue,
  updateCampaign,
  type Campaigns,
} from "../src/ui/campaignState.ts";
import {
  applyCoordinatorSample,
  createDockingCoordinator,
  type DockingCoordinator,
} from "../src/ui/dockingCoordinator.ts";

const ORIGIN = { latitude: 39.7392, longitude: -104.9903 };

function campaigns(): Campaigns {
  return {
    live: createGame({ origin: ORIGIN, seed: "live-isolation" }),
    training: createGame({ origin: ORIGIN, seed: "training-isolation" }),
  };
}

test("training mutations cannot alter live credits, cargo, markets, encounters, or discoveries", () => {
  const before = campaigns();
  const next = updateCampaign(before, "training", (training) => ({
    ...training,
    discoveredPortIds: [...training.discoveredPortIds, "port-1"],
    encounter: { type: "pirates", severity: 1, portId: "port-0" },
    player: { ...training.player, credits: 123, cargo: { ion_fuel: 2 } },
    ports: training.ports.map((port, index) => index === 0
      ? { ...port, market: port.market.map((quote) => ({ ...quote, stock: quote.stock - 1 })) }
      : port),
  }));

  assert.equal(next.live, before.live);
  assert.deepEqual(next.live, before.live);
  assert.notDeepEqual(next.training, before.training);
});

test("exact market access requires the campaign dock and current valid coordinator to agree", () => {
  const game = campaigns().live;
  const valid = createDockingCoordinator({ id: "port-0", coords: game.ports[0].position });
  const completed = {
    ...valid,
    proofConsumed: true,
    session: { ...valid.session, status: "docked" as const },
    authorizedDock: {
      target: valid.target,
      session: { ...valid.session, status: "docked" as const },
    },
  };

  assert.equal(activeDockedPort(game, completed)?.id, "port-0");
  assert.equal(activeDockedPort(game, valid), null);
  assert.equal(activeDockedPort(game, {
    ...completed,
    target: { id: "port-1", coords: game.ports[1].position },
    session: { ...completed.session, portId: "port-1", status: "armed", proof: null },
  })?.id, "port-0");
});

test("campaign persistence serializes overlapping snapshots and finishes with the latest state", async () => {
  const started: string[] = [];
  const resolvers: Array<() => void> = [];
  const queue = createLatestWriteQueue<string>((snapshot) => new Promise<void>((resolve) => {
    started.push(snapshot);
    resolvers.push(resolve);
  }));

  const first = queue.schedule("first");
  const second = queue.schedule("second");
  const third = queue.schedule("third");
  assert.deepEqual(started, ["first"]);

  resolvers.shift()!();
  await Promise.resolve();
  assert.deepEqual(started, ["first", "third"]);
  resolvers.shift()!();
  await Promise.all([first, second, third]);
});

test("a proof write-through cannot resolve or be replaced by a later routine save", async () => {
  const started: string[] = [];
  const resolvers: Array<() => void> = [];
  const queue = createLatestWriteQueue<string>((snapshot) => new Promise<void>((resolve) => {
    started.push(snapshot);
    resolvers.push(resolve);
  }));

  const first = queue.schedule("before-proof");
  const proof = queue.writeThrough("proof");
  const later = queue.schedule("later-routine-save");
  let proofResolved = false;
  void proof.then(() => { proofResolved = true; });

  resolvers.shift()!();
  await Promise.resolve();
  assert.deepEqual(started, ["before-proof", "proof"]);
  assert.equal(proofResolved, false);

  resolvers.shift()!();
  await proof;
  assert.deepEqual(started, ["before-proof", "proof", "later-routine-save"]);

  resolvers.shift()!();
  await Promise.all([first, proof, later]);
});

test("a completed coordinator transition returns game and proof state together", async () => {
  const campaignState = await import("../src/ui/campaignState.ts");
  const resolveCoordinatorTransition = Reflect.get(
    campaignState,
    "resolveCoordinatorTransition",
  ) as unknown;
  assert.equal(
    typeof resolveCoordinatorTransition,
    "function",
    "resolveCoordinatorTransition must atomically derive both state branches",
  );

  const game = campaigns().training;
  let coordinator = createDockingCoordinator({
    id: game.ports[0].id,
    coords: game.ports[0].position,
  });
  for (let elapsed = 0; elapsed <= 600_000; elapsed += 15_000) {
    coordinator = applyCoordinatorSample(coordinator, {
      latitude: game.ports[0].position.latitude,
      longitude: game.ports[0].position.longitude,
      horizontalAccuracyMeters: 5,
      altitudeMeters: null,
      verticalAccuracyMeters: null,
      headingDegrees: null,
      speedMetersPerSecond: 0,
      recordedAtMs: elapsed,
      isMocked: false,
    }, elapsed);
  }
  const proofId = coordinator.session.proof?.id;
  assert.ok(proofId);

  const transition = (resolveCoordinatorTransition as (
    game: GameState,
    coordinator: DockingCoordinator,
  ) => { game: GameState; coordinator: DockingCoordinator; proofId: string | null })(
    game,
    coordinator,
  );

  assert.equal(transition.game.dockedPortId, "port-0");
  assert.equal(transition.coordinator.proofConsumed, true);
  assert.equal(transition.proofId, proofId);
});
