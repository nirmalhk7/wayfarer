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
  resolveEncounter,
  trade,
} from "../app/game/engine.mjs";

const ORIGIN = { latitude: 39.7392, longitude: -104.9903 };

function gameAtOrigin(seed = "test-seed") {
  return createGame({ ...ORIGIN, seed });
}

function originPort(game) {
  return game.ports.find((port) => port.id === game.originPortId);
}

test("createGame starts legitimately docked at an origin freeport with six nearby ports", () => {
  const game = gameAtOrigin();
  const again = gameAtOrigin();
  const freeport = originPort(game);

  assert.equal(game.ports.length, 7);
  assert.deepEqual(game, again);
  assert.equal(game.player.credits, 900);
  assert.equal(game.player.cargoCapacity, 8);
  assert.equal(game.player.hull, 1);
  assert.deepEqual(game.discoveredPortIds, [game.originPortId]);
  assert.equal(game.dockedPortId, game.originPortId);
  assert.equal(freeport.name, "Wayfarer Freeport");
  assert.deepEqual(freeport.position, ORIGIN);
  assert.equal(canDock(game, freeport.id, ORIGIN), true);
  assert.ok(COMMODITIES.length >= 3);
  assert.doesNotThrow(() => JSON.stringify(game));

  for (const port of game.ports.slice(1)) {
    const distance = distanceMeters(ORIGIN, port.position);
    assert.ok(distance >= 250 && distance <= 1200, `${port.name}: ${distance}`);
    assert.equal(port.market.length, COMMODITIES.length);
  }
  assert.equal(freeport.market.length, COMMODITIES.length);
});

test("distanceMeters computes nearby geographic distances", () => {
  const meters = distanceMeters(
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.001 },
  );

  assert.ok(meters > 110 && meters < 112);
});

test("rumors reveal only qualitative prices until docking", () => {
  const game = gameAtOrigin();
  const port = originPort(game);
  const rumors = getRumors(game, port.id);

  assert.equal(rumors.length, COMMODITIES.length);
  assert.deepEqual(
    new Set(rumors.map((rumor) => rumor.price)),
    new Set(rumors.map((rumor) => rumor.price).filter((price) =>
      ["cheap", "fair", "expensive"].includes(price),
    )),
  );
  assert.ok(rumors.every((rumor) => !Object.hasOwn(rumor, "exactPrice")));
  assert.ok(rumors.every((rumor) => !Object.hasOwn(rumor, "stock")));
  assert.throws(() => getRumors(game, "missing-port"), /unknown port/i);
});

test("docking requires proximity, preserves input, and reveals the port market", () => {
  const game = gameAtOrigin();
  const target = game.ports.find((port) => port.id !== game.originPortId);

  assert.equal(canDock(game, target.id, ORIGIN), false);
  assert.throws(() => dock(game, target.id, ORIGIN), /too far/i);

  const docked = dock(game, target.id, ORIGIN, { demo: true });
  assert.notEqual(docked, game);
  assert.equal(docked.dockedPortId, target.id);
  assert.ok(docked.discoveredPortIds.includes(target.id));
  assert.ok(docked.revealedMarkets[target.id]);
  assert.equal(game.dockedPortId, game.originPortId);
});

test("trade debits credits, fills cargo, changes stock and raises local buy price", () => {
  const game = gameAtOrigin();
  const port = originPort(game);
  const item = port.market.find((entry) => entry.stock >= 2);
  const beforeCredits = game.player.credits;
  const beforeStock = item.stock;
  const beforePrice = item.price;

  const bought = trade(game, {
    portId: port.id,
    commodityId: item.commodityId,
    side: "buy",
    quantity: 2,
  });
  const after = bought.ports.find((candidate) => candidate.id === port.id)
    .market.find((entry) => entry.commodityId === item.commodityId);

  assert.equal(bought.player.credits, beforeCredits - beforePrice * 2);
  assert.equal(bought.player.cargo[item.commodityId], 2);
  assert.equal(after.stock, beforeStock - 2);
  assert.ok(after.price > beforePrice);
  assert.equal(game.player.cargo[item.commodityId] ?? 0, 0);
});

test("trade rejects undocked ports, unaffordable orders, and cargo overflow", () => {
  const game = gameAtOrigin();
  const port = originPort(game);
  const item = port.market[0];
  const remote = game.ports.find((candidate) => candidate.id !== port.id);

  assert.throws(
    () => trade(game, { portId: remote.id, commodityId: item.commodityId, side: "buy", quantity: 1 }),
    /docked/i,
  );
  assert.throws(
    () => trade(game, { portId: port.id, commodityId: item.commodityId, side: "buy", quantity: 999 }),
    /stock|capacity|credits/i,
  );
  assert.throws(
    () => trade(game, { portId: port.id, commodityId: item.commodityId, side: "buy", quantity: 9 }),
    /capacity/i,
  );
});

test("selling cargo pays credits, restores stock, and lowers local price", () => {
  const game = gameAtOrigin();
  const port = originPort(game);
  const item = port.market.find((entry) => entry.stock >= 1);
  const bought = trade(game, { portId: port.id, commodityId: item.commodityId, side: "buy", quantity: 1 });
  const buyMarket = bought.ports.find((candidate) => candidate.id === port.id).market
    .find((entry) => entry.commodityId === item.commodityId);

  const sold = trade(bought, { portId: port.id, commodityId: item.commodityId, side: "sell", quantity: 1 });
  const sellMarket = sold.ports.find((candidate) => candidate.id === port.id).market
    .find((entry) => entry.commodityId === item.commodityId);

  assert.equal(sold.player.cargo[item.commodityId] ?? 0, 0);
  assert.equal(sellMarket.stock, buyMarket.stock + 1);
  assert.ok(sellMarket.price < buyMarket.price);
  assert.ok(sold.player.credits > bought.player.credits);
});

test("buying then selling at the same port cannot create free credits", () => {
  const game = gameAtOrigin();
  const port = originPort(game);
  const item = port.market.find((entry) => entry.stock >= 1);
  const bought = trade(game, {
    portId: port.id,
    commodityId: item.commodityId,
    side: "buy",
    quantity: 1,
  });
  const sold = trade(bought, {
    portId: port.id,
    commodityId: item.commodityId,
    side: "sell",
    quantity: 1,
  });

  assert.ok(sold.player.credits <= game.player.credits);
});

test("upgrades cost credits and improve cargo or hull without mutating state", () => {
  const game = gameAtOrigin();
  const cargoUpgraded = buyUpgrade(game, "cargo");
  const hullUpgraded = buyUpgrade(cargoUpgraded, "hull");

  assert.ok(cargoUpgraded.player.cargoCapacity > game.player.cargoCapacity);
  assert.ok(cargoUpgraded.player.credits < game.player.credits);
  assert.ok(hullUpgraded.player.hull > cargoUpgraded.player.hull);
  assert.throws(() => buyUpgrade(game, "warp-drive"), /unknown upgrade/i);
});

test("encounter choices resolve partial outcomes and never erase all resources", () => {
  const game = gameAtOrigin("encounter-seed");
  const port = game.ports.find((candidate) => candidate.id !== game.originPortId);
  const docked = dock(game, port.id, ORIGIN, { demo: true });
  const forced = {
    ...docked,
    encounter: { type: "pirates", severity: 2, portId: port.id },
    player: { ...docked.player, credits: 500, cargo: { fuel: 3 }, hull: 2 },
  };

  const resolved = resolveEncounter(forced, "run");

  assert.equal(resolved.encounter, null);
  assert.ok(resolved.player.credits >= 0);
  assert.ok(resolved.player.hull >= 1);
  assert.ok((resolved.player.cargo.fuel ?? 0) < 3);
  assert.equal(forced.player.cargo.fuel, 3);
  assert.throws(() => resolveEncounter(game, "run"), /no encounter/i);
});
