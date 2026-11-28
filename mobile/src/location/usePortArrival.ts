import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { Coordinates } from "../game/engine";
import { atlas } from "../atlas/download";
import { resolvePort, tileKey, type AtlasPort, type AtlasTile } from "../atlas/geometry";
import { observationQuality, FIX_MAX_AGE_MS } from "../territories/subdivisions";
import { createWalkingVisit } from "./walkingVisit";

const waiting = "Waiting for a fresh location fix";
type Presence = { visitUntil?: number; port: AtlasPort | null; validUntil: number; status: string; position?: Coordinates; tile?: AtlasTile };
const paused: Presence = { port: null, validUntil: 0, status: "Live navigation paused" };
const status = {
  stale: "Location fix expired",
  poor: "Location accuracy is too low",
  border: "Near a port boundary. Market access paused.",
  outside: "No port confirmed here",
};

export function usePortArrival(enabled: boolean, attempt: number) {
  const [presence, setPresence] = useState(paused);
  const current = useRef(paused);
  const [motion, setMotion] = useState("Walking detection is off");

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
    let observations = 0;
    const walking = createWalkingVisit();
    let motionWatcher: Location.LocationSubscription | undefined;
    let visitExpiry: ReturnType<typeof setTimeout> | undefined;
    let watcher: Location.LocationSubscription | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;

    function publish(next: Presence) {
      clearTimeout(expiry);
      clearTimeout(visitExpiry);
      if (next.visitUntil && next.visitUntil > Date.now()) {
        visitExpiry = setTimeout(() => {
          const latest = { ...current.current, visitUntil: 0 };
          current.current = latest;
          setPresence(latest);
        }, next.visitUntil - Date.now());
      }
      current.current = next;
      setPresence(next);
      if (next.position) {
        expiry = setTimeout(() => publish({ ...paused, status: status.stale }), Math.max(0, next.validUntil - Date.now()));
      }
    }

    function stop(message: string) {
      run++;
      watcher?.remove();
      watcher = undefined;
      motionWatcher?.remove();
      motionWatcher = undefined;
      walking.suspend();
      setMotion("Walking detection is off");
      publish({ ...paused, status: message });
    }

    async function start() {
      const id = ++run;
      const request = prompt;
      prompt = false;
      publish({ ...paused, status: waiting });
      setMotion("Checking walking detection");
      async function startMotion() {
        const unavailable = () => {
          if (removed || id !== run) return;
          walking.suspend();
          publish({ ...current.current, visitUntil: 0 });
          setMotion("Walking detection is unavailable on this device");
        };
        try {
          const permission = request
            ? await Location.requestMotionActivityPermissionsAsync()
            : await Location.getMotionActivityPermissionsAsync();
          if (removed || id !== run) return;
          if (!permission.granted) { setMotion("Allow Physical activity to log visits and trade"); return; }
          const subscription = await Location.watchMotionActivityAsync(({ activities, timestamp }) => {
            if (removed || id !== run) return;
            const kind = activities.automotive.detected || activities.cycling.detected ? "vehicle"
              : activities.unknown.detected || activities.running.detected ? "unknown"
              : activities.walking.detected && activities.walking.confidence === Location.MotionActivityConfidence.High
                && !activities.stationary.detected ? "walking"
                : activities.stationary.detected && !activities.walking.detected ? "stationary" : "unknown";
            if (walking.activity(kind, timestamp, Date.now())) publish({ ...current.current, visitUntil: 0 });
          }, unavailable);
          if (removed || id !== run) { subscription.remove(); return; }
          motionWatcher = subscription;
          setMotion("Walk inside this port to log a visit and unlock its market");
        } catch {
          unavailable();
        }
      }
      const accept = (fix: Location.LocationObject) => {
        if (removed || id !== run) return;
        const now = Date.now();
        if (fix.timestamp <= lastTimestamp) return;
        if (Number.isFinite(fix.timestamp) && fix.timestamp <= now) lastTimestamp = fix.timestamp;
        const observation = ++observations;
        const position = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        const quality = observationQuality({
          ...position, timestamp: fix.timestamp, accuracy: fix.coords.accuracy, mocked: fix.mocked,
        }, now);
        if (quality.kind !== "usable") {
          walking.clear();
          publish({ ...paused, status: status[quality.kind] });
          return;
        }
        const { radius } = quality;
        const sample = { ...position, timestamp: fix.timestamp, accuracy: fix.coords.accuracy!, speed: fix.coords.speed };
        const key = tileKey(position);
        const validUntil = fix.timestamp + FIX_MAX_AGE_MS;
        const isCurrent = () => !removed && id === run && observations === observation;
        function arrive(tile: AtlasTile | null) {
          if (!isCurrent()) return;
          if (Date.now() >= validUntil) {
            walking.clear();
            publish({ ...paused, status: status.stale });
            return;
          }
          if (!tile) {
            walking.clear();
            publish({ ...paused, status: "No port data covers this region" });
            return;
          }
          const result = resolvePort(tile, position, radius);
          const port = result.kind === "inside" ? result.port : null;
          const visitUntil = walking.observe(port?.id, sample, Date.now());
          publish({
            visitUntil, port, validUntil, position, tile,
            status: result.kind === "inside" ? "Arrived in " + result.port.name : status[result.kind],
          });
        }
        const cached = atlas.peek(key);
        if (cached !== undefined) {
          arrive(cached);
          return;
        }
        walking.observe(undefined, sample, now);
        publish({ ...paused, status: "Loading port data" });
        void atlas.load(key).then(arrive).catch(() => {
          if (isCurrent()) publish({ ...paused, status: "Port data unavailable in this build" });
        });
      };
      try {
        const permission = request
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();
        if (removed || id !== run) return;
        if (permission.status !== "granted") {
          setMotion("Walking detection is off");
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
        void startMotion();
        // A late initial fix cannot replace a newer location delivered by the watcher.
        try { accept(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })); }
        catch { if (!removed && id === run && current.current.status === waiting) publish({ ...paused, status: "Waiting for GPS" }); }
      } catch {
        if (!removed && id === run) stop("Location unavailable");
      }
    }

    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") stop("Live market access paused in the background");
      else if (!watcher) void start();
    });
    if (AppState.currentState === "active") void start();
    return () => {
      removed = true;
      watcher?.remove();
      motionWatcher?.remove();
      clearTimeout(expiry);
      clearTimeout(visitExpiry);
      current.current = paused;
      appState.remove();
    };
  }, [enabled, attempt]);

  const fresh = enabled && Date.now() < presence.validUntil;
  return {
    presence: enabled ? presence : paused,
    compassPosition: fresh ? presence.position : undefined,
    compassTile: fresh ? presence.tile : undefined,
    motion,
    eligible: fresh && Date.now() < (presence.visitUntil ?? 0),
    eligiblePortId: () => enabled && Date.now() < (current.current.visitUntil ?? 0) ? current.current.port?.id : undefined,
  };
}
