import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Encounter, MarketQuote, PlayerState, TradeReceipt } from "../game/engine";
import type { LiveContactChoice } from "../game/liveEncounters";

type Snapshot = {
  version: number;
  player: PlayerState;
  markets: { id: string; market: MarketQuote[] }[];
  pendingLiveEncounter: Encounter | null;
  lastTrade: TradeReceipt | null;
};

type Command = { kind: "reset" } | ({ portId: string } & (
  | { kind: "arrive" }
  | { kind: "trade"; side: "buy" | "sell"; commodityId: string; quantity: number; unitPrice: number }
  | { kind: "upgrade"; upgrade: "cargo" | "hull" }
  | { kind: "contact"; choice: LiveContactChoice }
));
type Order = Command & { version: number; id: string };

function marketOrigin() {
  return process.env.EXPO_PUBLIC_WAYFARER_TRADE_URL?.replace(/\/+$/, "");
}

export function networkMarketAvailable() {
  const origin = marketOrigin();
  return !!origin && (/^https:\/\/[^/?#]+$/.test(origin)
    || (__DEV__ && /^http:\/\/(?:10\.0\.2\.2|127\.0\.0\.1):\d+$/.test(origin)));
}
const sessionKey = "wayfarer.mobile.server-market.session.v1";
const pendingKey = "wayfarer.mobile.server-market.pending.v1";

class MarketError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request(token: string, order?: Order, id?: string): Promise<Snapshot & { applied?: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(marketOrigin() + "/v1/live", {
      method: order ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        ...(order ? { "Content-Type": "application/json" } : {}),
        ...(id ? { "X-Wayfarer-Command": id } : {}),
      },
      body: order ? JSON.stringify(order) : undefined,
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new MarketError(data.error ?? "Trade service unavailable", response.status);
    if (!Number.isSafeInteger(data.version) || !data.player || !Array.isArray(data.markets)) {
      throw new Error("Trade service unavailable");
    }
    return data;
  } finally { clearTimeout(timeout); }
}

export function useServerMarket(active: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<Order>();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const latest = useRef(snapshot);
  const enabled = useRef(active);
  enabled.current = active;

  function publish(value: Snapshot) {
    latest.current = value;
    setSnapshot(value);
  }

  const perform = useCallback(async (command?: Command, retryAt?: string, permitted?: () => boolean) => {
    if (!enabled.current || running.current) return false;
    running.current = true;
    setBusy(true);
    setStatus("");
    try {
      let token = await AsyncStorage.getItem(sessionKey);
      if (!token) {
        const bytes = await Crypto.getRandomBytesAsync(32);
        token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        await AsyncStorage.setItem(sessionKey, token);
      }
      const encoded = await AsyncStorage.getItem(pendingKey);
      let saved = encoded ? JSON.parse(encoded) as Order : undefined;
      let current = latest.current;
      if (!current || saved || !command) {
        const fresh = await request(token, undefined, saved?.id);
        publish(fresh);
        current = fresh;
        if (saved && (fresh.applied || fresh.version > saved.version)) {
          await AsyncStorage.removeItem(pendingKey);
          saved = undefined;
        }
        setPending(saved);
      }

      if (saved && !command && (saved.kind === "reset" || ("portId" in saved && saved.portId === retryAt))) {
        if (!enabled.current || (permitted && !permitted())) return false;
        return await submit(saved);
      } else if (saved) {
        setStatus("An order is pending. Reconnect and retry it from the same port.");
      } else if (command) {
        if (!enabled.current || (permitted && !permitted())) return false;
        const order: Order = { ...command, version: current.version, id: Crypto.randomUUID() };
        await AsyncStorage.setItem(pendingKey, JSON.stringify(order));
        setPending(order);
        if (!enabled.current || (permitted && !permitted())) return false;
        return await submit(order);
      }

      return false;

      async function submit(order: Order) {
        try {
          publish(await request(token!, order));
          await AsyncStorage.removeItem(pendingKey);
          setPending(undefined);
          return true;
        } catch (error) {
          if (error instanceof MarketError && error.status < 500) {
            const fresh = await request(token!, undefined, order.id);
            publish(fresh);
            if (fresh.applied || fresh.version > order.version || error.status === 422) {
              await AsyncStorage.removeItem(pendingKey);
              setPending(undefined);
            }
            if (fresh.applied) return true;
          }
          throw error;
        }
      }
    } catch (error) {
      setStatus(error instanceof MarketError && error.status < 500
        ? error.message : "Connect to the trade server to use Live markets.");
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (active) void perform();
  }, [active, perform]);

  return { snapshot, status, pending, busy, perform };
}
