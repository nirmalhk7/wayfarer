import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMODITIES,
  DELIVERY,
  UPGRADE_COSTS,
  acceptDelivery,
  completeDelivery,
  buyUpgrade,
  canConfirmDock,
  canDock,
  createGame,
  deliveryRoute,
  distanceMeters,
  dock,
  getRumors,
  marketQuote,
  resolveEncounter,
  trade,
} from "../app/game/engine.mjs";

const ORIGIN = { latitude: 0, longitude: 0 };

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

test("bulk trades cannot push same-port bids above even the lowest local ask", () => {
  const game = buyUpgrade(buyUpgrade(gameAtOrigin("wayfarer-training-v1"), "cargo"), "cargo");
  const portId = game.originPortId;
  const commodityId = "fuel";
  const quantity = marketQuote(game, portId, commodityId).maxBuy;
  assert.equal(quantity, 15);

  const bought = trade(game, { portId, commodityId, quantity, side: "buy" });
  const peak = marketQuote(bought, portId, commodityId);
  const sold = trade(bought, { portId, commodityId, quantity, side: "sell" });
  const trough = marketQuote(sold, portId, commodityId);

  assert.equal(peak.ask, 28);
  assert.equal(trough.ask, 24);
  assert.ok(peak.bid < trough.ask);
  assert.ok(sold.lastTrade.profit < 0);
  assert.ok(sold.player.credits < game.player.credits);
  assert.equal(trough.stock, marketQuote(game, portId, commodityId).stock);
});

test("the first trade in an older market anchors future movement to its saved quote", () => {
  const game = gameAtOrigin();
  const port = originPort(game);
  const item = port.market[0];
  delete item.referencePrice;
  item.price = 20;
  const order = { portId: port.id, commodityId: item.commodityId, quantity: 8 };

  const bought = trade(game, { ...order, side: "buy" });
  const sold = trade(bought, { ...order, side: "sell" });
  const updated = originPort(sold).market[0];
  assert.equal(bought.lastTrade.unitPrice, 20);
  assert.equal(updated.referencePrice, 20);
  assert.equal(updated.price, 18);
  assert.equal(item.referencePrice, undefined);
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

test("an upgraded cargo bay can load a shipment the original hold could not", () => {
  const game = gameAtOrigin();
  const order = { portId: game.originPortId, commodityId: "fuel", side: "buy", quantity: 9 };
  assert.throws(() => trade(game, order), /cargo capacity/i);
  const upgraded = buyUpgrade(game, "cargo");
  assert.equal(upgraded.player.credits, game.player.credits - UPGRADE_COSTS.cargo);
  assert.equal(upgraded.player.cargoCapacity, 12);
  assert.equal(trade(upgraded, order).player.cargo.fuel, 9);
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

test("only an accurate position fully inside the docking radius can confirm an arrival", () => {
  const game = gameAtOrigin();
  const port = originPort(game);
  const offset = { latitude: 0, longitude: 0.001 };

  assert.equal(canConfirmDock(game, port.id, { ...offset, accuracy: 8 }), true);
  assert.equal(canConfirmDock(game, port.id, { ...offset, accuracy: 10 }), false);
  assert.equal(canConfirmDock(game, port.id, { ...ORIGIN, accuracy: 121 }), false);
  assert.equal(canConfirmDock(game, port.id, { ...ORIGIN, accuracy: -1 }), false);
  assert.equal(canConfirmDock(game, port.id, ORIGIN), false);
});

test("the training route pays the quoted spread and records the sale after arrival", () => {
  const game = gameAtOrigin("wayfarer-training-v1");
  const order = { commodityId: "fuel", quantity: 3 };
  const origin = originPort(game);
  const destination = game.ports.find(({ name }) => name === "Cinder Exchange");
  const opening = marketQuote(game, origin.id, order.commodityId);
  assert.deepEqual(opening, { ask: 26, bid: 18, stock: origin.market[0].stock, maxBuy: 8, maxSell: 0 });

  const bought = trade(game, { ...order, portId: origin.id, side: "buy" });
  const sale = { ...order, portId: destination.id, side: "sell" };
  assert.equal(bought.lastTrade.total, 78);
  assert.throws(() => trade(bought, sale), /must be docked/i);
  assert.throws(() => dock(bought, destination.id, origin.position), /too far/i);

  const arrived = dock(bought, destination.id, destination.position);
  const closed = trade(JSON.parse(JSON.stringify(arrived)), sale);
  assert.equal(closed.player.credits, 912);
  assert.equal(closed.player.cargo.fuel, undefined);
  assert.deepEqual(closed.discoveredPortIds, [origin.id, destination.id]);
  assert.deepEqual(closed.lastTrade, { ...sale, unitPrice: 30, total: 90, costBasis: 78, profit: 12 });
});

test("cost basis follows first-in first-out purchases of different prices", () => {
  const game = gameAtOrigin();
  const order = { portId: game.originPortId, commodityId: "fuel" };
  const first = trade(game, { ...order, side: "buy", quantity: 2 });
  const next = trade(first, { ...order, side: "buy", quantity: 3 });

  const sold = trade(next, { ...order, side: "sell", quantity: 3 });
  const cost = 2 * first.lastTrade.unitPrice + next.lastTrade.unitPrice;
  assert.equal(sold.lastTrade.costBasis, cost);
  assert.equal(sold.lastTrade.profit, sold.lastTrade.total - cost);
  assert.deepEqual(sold.player.cargoLots.fuel, [{ quantity: 2, unitCost: next.lastTrade.unitPrice }]);
  assert.equal(next.player.cargo.fuel, 5);
});

test("older cargo sells without invented profit and does not taint later known purchases", () => {
  const game = gameAtOrigin();
  game.player.cargo.fuel = 2;
  const order = { portId: game.originPortId, commodityId: "fuel" };
  const bought = trade(game, { ...order, side: "buy", quantity: 2 });
  const sold = trade(bought, { ...order, side: "sell", quantity: 3 });
  const last = trade(sold, { ...order, side: "sell", quantity: 1 });
  assert.equal(sold.lastTrade.costBasis, null);
  assert.equal(sold.lastTrade.profit, null);
  assert.equal(last.lastTrade.costBasis, bought.lastTrade.unitPrice);
});

test("encounter losses remove the same units from the hold and the purchase ledger", () => {
  const game = gameAtOrigin("wayfarer-training-v1");
  const order = { portId: game.originPortId, commodityId: "fuel", side: "buy" };
  const first = trade(game, { ...order, quantity: 1 });
  const next = trade(first, { ...order, quantity: 2 });
  const target = next.ports.find(({ name }) => name === "Lumen Reach");
  const arrived = dock(next, target.id, target.position);
  assert.ok(arrived.encounter);
  const resolved = resolveEncounter(arrived, "run");
  assert.equal(resolved.player.cargo.fuel, 2);
  assert.deepEqual(resolved.player.cargoLots.fuel, [{ quantity: 2, unitCost: next.lastTrade.unitPrice }]);
  assert.equal(dock(resolved, target.id, target.position).encounter, null);
});

test("a delivery reserves only new origin purchases and pays once across reload", () => {
  const original = gameAtOrigin("wayfarer-training-v1");
  const { origin, destination } = deliveryRoute(original);
  const { commodityId, quantity, reward } = DELIVERY;
  const order = { commodityId, quantity, side: "buy" };
  const older = trade(original, { ...order, portId: origin.id });
  const accepted = acceptDelivery(older);
  assert.equal(accepted.delivery.loaded, 0);
  const remote = dock(accepted, destination.id, destination.position);
  const wrongPort = trade(remote, { ...order, portId: destination.id });
  assert.equal(wrongPort.delivery.loaded, 0);
  assert.throws(() => completeDelivery(wrongPort), /buy the contract fuel/i);

  const loaded = trade(accepted, { ...order, portId: origin.id });
  assert.equal(loaded.delivery.loaded, quantity);
  assert.throws(() => trade(loaded, { ...order, quantity: quantity + 1, portId: origin.id, side: "sell" }), /reserved/i);
  assert.throws(() => completeDelivery(loaded), /dock at the delivery/i);
  const arrived = dock(loaded, destination.id, destination.position);
  const completed = completeDelivery(JSON.parse(JSON.stringify(arrived)));
  assert.equal(completed.player.credits, arrived.player.credits + reward);
  assert.equal(completed.player.cargo[commodityId], quantity);
  assert.throws(() => completeDelivery(JSON.parse(JSON.stringify(completed))), /no active delivery/i);
  assert.throws(() => acceptDelivery(completed), /already been accepted/i);
});
