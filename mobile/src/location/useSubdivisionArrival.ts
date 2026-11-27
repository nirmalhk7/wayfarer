import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { assessObservation, FIX_MAX_AGE_MS } from "../territories/subdivisions";

const waiting = "Waiting for a fresh location fix";
type Presence = { geoid: string | null; validUntil: number; status: string };
const paused: Presence = { geoid: null, validUntil: 0, status: "Live navigation paused" };
const status = {
  stale: "Location fix expired",
  poor: "Location accuracy is too low",
  border: "Near a subdivision boundary. Market access paused.",
  outside: "Outside the North Coast Live pilot",
};

export function useSubdivisionArrival(enabled: boolean, attempt: number) {
  const [presence, setPresence] = useState(paused);
  const current = useRef(paused);

  useEffect(() => {
    if (!enabled) {
      current.current = paused;
      setPresence(paused);
      return;
    }

    let run = 0;
    let removed = false;
    let prompt = true;
    let lastTimestamp = -Infinity;
    let watcher: Location.LocationSubscription | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;

    function publish(next: Presence) {
      clearTimeout(expiry);
      current.current = next;
      setPresence(next);
      if (next.geoid) {
        expiry = setTimeout(() => publish({ ...paused, status: status.stale }), Math.max(0, next.validUntil - Date.now()));
      }
    }

    function stop(message: string) {
      run++;
      watcher?.remove();
      watcher = undefined;
      publish({ ...paused, status: message });
    }

    async function start() {
      const id = ++run;
      const request = prompt;
      prompt = false;
      publish({ ...paused, status: waiting });
      const accept = (fix: Location.LocationObject) => {
        if (removed || id !== run) return;
        const now = Date.now();
        if (fix.timestamp <= lastTimestamp) return;
        if (Number.isFinite(fix.timestamp) && fix.timestamp <= now) lastTimestamp = fix.timestamp;
        const result = assessObservation({
          timestamp: fix.timestamp,
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracy: fix.coords.accuracy,
          mocked: fix.mocked,
        }, now);
        publish(result.kind === "inside"
          ? { geoid: result.port.geoid, validUntil: fix.timestamp + FIX_MAX_AGE_MS, status: "Arrived in " + result.port.name }
          : { ...paused, status: status[result.kind] });
      };
      try {
        const permission = request
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();
        if (removed || id !== run) return;
        if (permission.status !== "granted") {
          publish({ ...paused, status: "Location permission denied" });
          return;
        }
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 5_000 },
          accept,
          () => { if (!removed && id === run) stop("Location unavailable"); },
        );
        if (removed || id !== run) { subscription.remove(); return; }
        watcher = subscription;
        // A late initial fix cannot replace a newer location delivered by the watcher.
        try { accept(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })); }
        catch { if (!removed && id === run && current.current.status === waiting) publish({ ...paused, status: "Waiting for GPS" }); }
      } catch {
        if (!removed && id === run) stop("Location unavailable");
      }
    }

    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") stop("Live market access paused in the background");
      else { watcher?.remove(); watcher = undefined; void start(); }
    });
    void start();
    return () => {
      removed = true;
      watcher?.remove();
      clearTimeout(expiry);
      current.current = paused;
      appState.remove();
    };
  }, [enabled, attempt]);

  return {
    presence: enabled ? presence : paused,
    currentGeoid: () => enabled && Date.now() < current.current.validUntil ? current.current.geoid : null,
  };
}
