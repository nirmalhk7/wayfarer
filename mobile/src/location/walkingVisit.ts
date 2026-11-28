import { distanceMeters, type Coordinates } from "../game/engine";

const FIX_WINDOW_MS = 10_000;
const ACTIVITY_WINDOW_MS = 15_000;
const WALK_WINDOW_MS = 50_000;
const VEHICLE_PAUSE_MS = 30_000;
const MAX_WALK_SPEED = 2.5;

type Fix = Coordinates & { timestamp: number; accuracy: number; speed: number | null };
type Activity = "walking" | "vehicle" | "stationary" | "unknown";

export function createWalkingVisit() {
  let county: string | undefined;
  let anchor: Fix | undefined;
  let previous: Fix | undefined;
  let vehicleUntil = 0;
  let latestActivity: { kind: Activity; time: number } | undefined;
  let firstWalking: number | undefined;
  let marketUntil = 0;

  function clear() {
    county = undefined;
    anchor = undefined;
    previous = undefined;
    firstWalking = undefined;
    marketUntil = 0;
  }

  return {
    clear,
    activity(kind: Activity, time: number, now: number) {
      if (!Number.isFinite(time) || time > now || now - time >= ACTIVITY_WINDOW_MS
        || (latestActivity && time <= latestActivity.time)) return false;
      const prior = latestActivity;
      latestActivity = { kind, time };
      if (kind === "vehicle") vehicleUntil = now + VEHICLE_PAUSE_MS;
      if (kind !== "walking") firstWalking = undefined;
      if (!prior || time - prior.time >= ACTIVITY_WINDOW_MS || kind === "vehicle" || kind === "unknown") {
        clear();
        return true;
      }
      return false;
    },
    observe(id: string | undefined, fix: Fix, now: number) {
      const { speed, accuracy, timestamp } = fix;
      const elapsed = previous ? timestamp - previous.timestamp : 0;
      const fastDisplacement = previous && elapsed > 0 && elapsed < FIX_WINDOW_MS
        && distanceMeters(previous, fix) - previous.accuracy - accuracy > MAX_WALK_SPEED * elapsed / 1000;
      if (fastDisplacement || (speed !== null && Number.isFinite(speed) && speed > MAX_WALK_SPEED)) {
        vehicleUntil = now + VEHICLE_PAUSE_MS;
      }
      const activity = latestActivity;
      if (!id || speed === null || !Number.isFinite(speed) || speed < 0 || speed > MAX_WALK_SPEED
        || accuracy > 25 || now - timestamp >= FIX_WINDOW_MS || now < vehicleUntil
        || !activity || now - activity.time >= ACTIVITY_WINDOW_MS
        || (activity.kind !== "walking" && activity.kind !== "stationary")) {
        clear();
        return 0;
      }

      if (county !== id || !anchor || !previous || elapsed >= FIX_WINDOW_MS) {
        clear();
        county = id;
        anchor = fix;
      } else if (timestamp - anchor.timestamp > WALK_WINDOW_MS) {
        anchor = previous;
        firstWalking = undefined;
      }

      if (activity.kind === "walking") {
        firstWalking ??= Math.max(anchor.timestamp, activity.time);
        const movement = distanceMeters(anchor, fix) - anchor.accuracy - accuracy;
        if (activity.time - firstWalking >= 12_000 && movement >= 12) {
          marketUntil = activity.time + 120_000;
        }
      } else if (!marketUntil) {
        // A stop cannot serve as the baseline of a walking qualification.
        anchor = fix;
      }
      previous = fix;
      return Math.min(marketUntil, timestamp + FIX_WINDOW_MS, activity.time + ACTIVITY_WINDOW_MS);
    },

    suspend() {
      clear();
      latestActivity = undefined;
    },
  };
}
