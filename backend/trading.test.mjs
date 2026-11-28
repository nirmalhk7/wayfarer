import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createTradeHandlers } from "./trading-http.mjs";

test("Live HTTP endpoints keep quotes, trades, idempotency and campaign data authoritative", async (t) => {
  const storage = new Map();
  let online = true;
  const store = {
    async check() { if (!online) throw new Error("private detail"); },
    async read(key) { await this.check(); return structuredClone(storage.get(key)); },
    async write(key, state, etag) {
      await this.check();
      if (storage.get(key)?.etag !== etag) return false;
      storage.set(key, { state: structuredClone(state), etag: randomUUID() });
      return true;
    },
  };
  const handler = createTradeHandlers(store);
  const server = createServer((req, res) => void (req.url === "/health" ? handler.health : handler.live)(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const root = "http://127.0.0.1:" + server.address().port;
  const live = async (body, options = {}) => {
    const { token = "a".repeat(64), command } = options;
    const response = await fetch(root + "/v1/live", {
      headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}),
        ...(command ? { "X-Wayfarer-Command": command } : {}) },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };

  let response = await fetch(root + "/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok", service: "wayfarer-backend", trading: "ready" });
  assert.equal((await live(null, { token: "invalid" })).status, 401);
  const portId = "county:06081";
  const run = (version, kind, fields = {}) => ({ version, kind, portId, id: randomUUID(), ...fields });
  let player = (await live()).body;
  assert.equal(player.version, 0);
  assert.equal(storage.size, 0);
  assert.equal((await live(run(0, "arrive", { portId: "county:99999" }))).status, 400);
  assert.equal((await live(run(0, "arrive", { latitude: 37.5 }))).status, 400);
  assert.equal((await live(run(0, "trade", { commodityId: "ion_fuel", side: "buy", quantity: 1, unitPrice: 37 }))).status, 422);
  player = (await live(run(0, "arrive"))).body;
  if (player.pendingLiveEncounter) player = (await live(run(player.version, "contact", { choice: "stop" }))).body;
  const quote = player.markets[0].market.find((item) => item.commodityId === "ion_fuel");
  const order = run(player.version, "trade", { commodityId: "ion_fuel", side: "buy", quantity: 2, unitPrice: quote.ask });
  assert.equal((await live({ ...order, quantity: 0 })).status, 400);
  assert.equal((await live({ ...order, unitPrice: 1 })).status, 422);
  assert.equal((await live({ ...order, quantity: 1000 })).status, 422);
  const results = await Promise.all([live(order), live({ ...order, id: randomUUID() })]);
  assert.deepEqual(results.map((reply) => reply.status).sort(), [200, 409]);
  const bought = (await live()).body;
  assert.equal(bought.player.cargo.ion_fuel, 2);
  assert.equal(bought.player.credits, player.player.credits - 2 * quote.ask);
  assert.equal(bought.markets[0].market.find((item) => item.commodityId === "ion_fuel").stock, quote.stock - 2);

  const winning = results[0].status === 200 ? order : null;
  const receipt = (await live(null, { command: order.id })).body;
  assert.equal(receipt.applied, Boolean(winning));
  assert.equal((await live(order)).status, winning ? 200 : 409);
  if (winning) assert.equal((await live({ ...order, quantity: 1 })).status, 409);
  const bid = bought.markets[0].market.find((item) => item.commodityId === "ion_fuel").bid;
  const sell = run(bought.version, "trade", { commodityId: "ion_fuel", side: "sell", quantity: 1, unitPrice: bid });
  assert.equal((await live({ ...sell, quantity: 3 })).status, 422);
  const sold = (await live(sell)).body;
  assert.equal(sold.player.cargo.ion_fuel, 1);
  assert.equal(sold.player.credits, bought.player.credits + bid);
  assert.deepEqual((await live(null, { token: "b".repeat(64) })).body, {
    version: 0, player: { credits: 900, cargoCapacity: 8, cargo: {}, hull: 3, maxHull: 3 },
    markets: [], pendingLiveEncounter: null, lastTrade: null,
  });

  online = false;
  response = await fetch(root + "/health");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable", service: "wayfarer-backend", trading: "unavailable" });
  assert.equal((await live(sell)).status, 503);
  online = true;
  assert.deepEqual((await live()).body, sold);
  const reset = { kind: "reset", version: sold.version, id: randomUUID() };
  const cleared = (await live(reset)).body;
  assert.equal(cleared.version, sold.version + 1);
  assert.equal(cleared.player.credits, 900);
  assert.deepEqual(cleared.markets, []);
  assert.deepEqual((await live(reset)).body, cleared);
  assert.equal((await live(null, { command: sell.id })).body.applied, false);
  assert.equal((await live(sell)).status, 409);
});
