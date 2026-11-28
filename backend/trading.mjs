import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createCountyCampaign, recordCountyVisit } from "../mobile/src/game/countyCampaign.ts";
import { buyUpgrade, COMMODITIES, trade } from "../mobile/src/game/engine.ts";
import { resolveLiveContact, rollLiveEncounter } from "../mobile/src/game/liveEncounters.ts";

const ranks = new Map(readFileSync(new URL("../tools/county2026-game-ranks.tsv", import.meta.url), "utf8")
  .trim().split("\n").slice(1).map((row) => {
    const [id, crime, patrol] = row.split("\t");
    return ["county:" + id, { crime: Number(crime), patrol: Number(patrol) }];
  }));
if (ranks.size !== 3144) throw new Error("Invalid county trading catalog");

const commodities = new Set(COMMODITIES.map(({ id }) => id));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const choices = new Set(["evade", "stop", "surrender", "fight"]);
const initial = () => ({ version: 0, game: createCountyCampaign(), journal: [] });

function actionFrom(value) {
  if (!value || !uuid.test(value.id) || !Number.isSafeInteger(value.version) || value.version < 0) return null;
  if (value.kind === "reset" && Object.keys(value).length === 3) {
    return { id: value.id, version: value.version, kind: "reset" };
  }
  if (typeof value.portId !== "string" || !ranks.has(value.portId)) return null;
  const common = { id: value.id, version: value.version, portId: value.portId };
  const keys = ["id", "version", "portId", "kind"];
  let action;
  if (value.kind === "arrive") action = { ...common, kind: "arrive" };
  if (value.kind === "contact" && choices.has(value.choice)) {
    keys.push("choice");
    action = { ...common, kind: "contact", choice: value.choice };
  }
  if (value.kind === "upgrade" && (value.upgrade === "cargo" || value.upgrade === "hull")) {
    keys.push("upgrade");
    action = { ...common, kind: "upgrade", upgrade: value.upgrade };
  }
  if (value.kind === "trade" && commodities.has(value.commodityId) && ["buy", "sell"].includes(value.side)
    && Number.isSafeInteger(value.quantity) && value.quantity > 0 && value.quantity <= 10_000
    && Number.isSafeInteger(value.unitPrice) && value.unitPrice > 0) {
    keys.push("commodityId", "side", "quantity", "unitPrice");
    action = { ...common, kind: "trade", commodityId: value.commodityId, side: value.side,
      quantity: value.quantity, unitPrice: value.unitPrice };
  }
  return action && Object.keys(value).every((key) => keys.includes(key)) ? action : null;
}

function command(game, action) {
  if (action.kind === "reset") return createCountyCampaign();
  const { portId } = action;
  if (action.kind === "arrive") {
    if (game.discoveredPortIds.includes(portId)) return game;
    const next = recordCountyVisit(game, { id: portId, name: portId });
    if (game.pendingLiveEncounter) return next;
    const pending = rollLiveEncounter(game.seed, portId, ranks.get(portId));
    return pending ? { ...next, pendingLiveEncounter: pending } : next;
  }
  if (game.pendingLiveEncounter?.portId === portId) {
    if (action.kind !== "contact") throw new Error("Resolve the contact before trading");
    return resolveLiveContact(game, portId, action.choice);
  }
  const market = game.ports.find(({ id }) => id === portId)?.market;
  if (!market) throw new Error("Visit this port first");
  if (action.kind === "upgrade") return buyUpgrade(game, action.upgrade);
  if (action.kind !== "trade") throw new Error("No contact at this port");
  const quote = market.find(({ commodityId }) => commodityId === action.commodityId);
  if (!quote || quote[action.side === "buy" ? "ask" : "bid"] !== action.unitPrice) {
    throw new Error("The quote changed. Review the latest price.");
  }
  const { commodityId, side, quantity } = action;
  return { ...trade({ ...game, dockedPortId: portId }, { portId, commodityId, side, quantity }), dockedPortId: null };
}

function view(state) {
  return {
    version: state.version,
    player: state.game.player,
    markets: state.game.ports.map(({ id, market }) => ({ id, market })),
    pendingLiveEncounter: state.game.pendingLiveEncounter ?? null,
    lastTrade: state.game.lastTrade ?? null,
  };
}

export function createTradingService(store) {
  return {
    async health() {
      try {
        await store.check();
        return { status: 200, body: { status: "ok", service: "wayfarer-backend", trading: "ready" } };
      } catch {
        return { status: 503, body: { status: "unavailable", service: "wayfarer-backend", trading: "unavailable" } };
      }
    },
    async live(method, authorization, input, requestedId) {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? "")?.[1];
      if (!token) return { status: 401, body: { error: "Session required" } };
      const key = createHash("sha256").update(token).digest("hex");
      const action = method === "POST" ? actionFrom(input) : null;
      if (method === "POST" && !action) return { status: 400, body: { error: "Invalid order" } };
      if (requestedId !== undefined && (method !== "GET" || !uuid.test(requestedId))) {
        return { status: 400, body: { error: "Invalid command ID" } };
      }
      try {
        const existing = await store.read(key);
        const state = existing?.state ?? initial();
        if (!action) return { status: 200, body: {
          ...view(state),
          ...(requestedId !== undefined ? { applied: state.journal.some(({ id }) => id === requestedId) } : {}),
        } };
        const signature = JSON.stringify(action);
        const previous = state.journal.find(({ id }) => id === action.id);
        if (previous) return previous.signature === signature
          ? { status: 200, body: view(state) }
          : { status: 409, body: { error: "Command ID already used" } };
        if (state.version !== action.version) return { status: 409, body: { error: "Market changed. Refresh your quotes." } };
        let game;
        try { game = command(state.game, action); }
        catch (error) { return { status: 422, body: { error: error.message } }; }
        const next = { version: state.version + 1, game,
          journal: [...(action.kind === "reset" ? [] : state.journal.slice(-127)), { id: action.id, signature }] };
        if (!await store.write(key, next, existing?.etag)) {
          return { status: 409, body: { error: "Market changed. Refresh your quotes." } };
        }
        return { status: 200, body: view(next) };
      } catch {
        return { status: 503, body: { error: "Trade service unavailable" } };
      }
    },
  };
}
