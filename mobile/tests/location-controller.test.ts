import assert from "node:assert/strict";
import test from "node:test";

import {
  BackgroundLocationError,
  createBackgroundLocationController,
  type BackgroundLocationDriver,
  type SelectedPortRegion,
} from "../src/location/controller.ts";
import * as locationControllerModule from "../src/location/controller.ts";

function fakeDriver(overrides: Partial<BackgroundLocationDriver> = {}) {
  const calls: string[] = [];
  const regions: Array<readonly SelectedPortRegion[]> = [];
  const driver: BackgroundLocationDriver = {
    isAvailable: async () => true,
    getForegroundPermission: async () => "granted",
    getBackgroundPermission: async () => "granted",
    requestForegroundPermission: async () => "granted",
    requestBackgroundPermission: async () => "granted",
    isGeofenceStarted: async () => false,
    startGeofence: async (nextRegions) => {
      calls.push("startGeofence");
      regions.push(nextRegions);
    },
    stopGeofence: async () => { calls.push("stopGeofence"); },
    isHighAccuracyTrackingStarted: async () => false,
    startHighAccuracyTracking: async () => { calls.push("startTracking"); },
    stopHighAccuracyTracking: async () => { calls.push("stopTracking"); },
    ...overrides,
  };
  return { calls, driver, regions };
}

test("permission request is ordered foreground then background", async () => {
  const order: string[] = [];
  const { driver } = fakeDriver({
    requestForegroundPermission: async () => { order.push("foreground"); return "granted"; },
    requestBackgroundPermission: async () => { order.push("background"); return "granted"; },
  });

  const result = await createBackgroundLocationController(driver).requestPermissions();

  assert.deepEqual(order, ["foreground", "background"]);
  assert.deepEqual(result, { foreground: "granted", background: "granted" });
});

test("background permission is not requested after foreground denial", async () => {
  let backgroundRequested = false;
  const { driver } = fakeDriver({
    requestForegroundPermission: async () => "denied",
    requestBackgroundPermission: async () => { backgroundRequested = true; return "granted"; },
  });

  const result = await createBackgroundLocationController(driver).requestPermissions();

  assert.equal(backgroundRequested, false);
  assert.deepEqual(result, { foreground: "denied", background: "denied" });
});

test("arming replaces the task with exactly one validated selected-port geofence", async () => {
  const { calls, driver, regions } = fakeDriver({ isGeofenceStarted: async () => true });
  const controller = createBackgroundLocationController(driver);

  await controller.armSelectedPort({
    portId: "port-2",
    latitude: 39.74,
    longitude: -104.99,
    radiusMeters: 75,
  });

  assert.deepEqual(calls, ["startGeofence"]);
  assert.deepEqual(regions, [[{
    portId: "port-2",
    latitude: 39.74,
    longitude: -104.99,
    radiusMeters: 75,
  }]]);
  await assert.rejects(
    controller.armSelectedPort({ portId: "", latitude: 91, longitude: 0, radiusMeters: 0 }),
    BackgroundLocationError,
  );
});

test("arming another target stops high accuracy for the prior selected port", async () => {
  const { calls, driver } = fakeDriver({ isHighAccuracyTrackingStarted: async () => true });

  await createBackgroundLocationController(driver).armSelectedPort({
    portId: "port-3",
    latitude: 39.75,
    longitude: -104.98,
    radiusMeters: 90,
  });

  assert.deepEqual(calls, ["stopTracking", "startGeofence"]);
});

test("rapid target changes register serially in request order", async () => {
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const registeredPortIds: string[] = [];
  const { driver } = fakeDriver({
    startGeofence: async (regions) => {
      registeredPortIds.push(regions[0].portId);
      if (regions[0].portId === "port-1") await firstPending;
    },
  });
  const controller = createBackgroundLocationController(driver);
  const first = controller.armSelectedPort({
    portId: "port-1", latitude: 39.7, longitude: -105, radiusMeters: 75,
  });
  const second = controller.armSelectedPort({
    portId: "port-2", latitude: 39.8, longitude: -105, radiusMeters: 75,
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(registeredPortIds, ["port-1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(registeredPortIds, ["port-1", "port-2"]);
});

test("geofence entry starts high accuracy once; exit stops it", async () => {
  let tracking = false;
  const { calls, driver } = fakeDriver({
    isHighAccuracyTrackingStarted: async () => tracking,
    startHighAccuracyTracking: async () => { calls.push("startTracking"); tracking = true; },
    stopHighAccuracyTracking: async () => { calls.push("stopTracking"); tracking = false; },
  });
  const controller = createBackgroundLocationController(driver);

  await controller.handleGeofenceTransition("enter");
  await controller.handleGeofenceTransition("enter");
  await controller.handleGeofenceTransition("exit");
  await controller.handleGeofenceTransition("exit");

  assert.deepEqual(calls, ["startTracking", "stopTracking"]);
});

test("geofence exit runs its persisted pause hook before stopping tracking", async () => {
  const calls: string[] = [];
  const { driver } = fakeDriver({
    isHighAccuracyTrackingStarted: async () => true,
    stopHighAccuracyTracking: async () => { calls.push("stopTracking"); },
  });
  const controller = createBackgroundLocationController(driver);

  await controller.handleGeofenceTransition("exit", undefined, async () => {
    calls.push("pausePersistedDocking");
  });

  assert.deepEqual(calls, ["pausePersistedDocking", "stopTracking"]);
});

test("geofence exit still stops tracking when persisted pause fails", async () => {
  const calls: string[] = [];
  const { driver } = fakeDriver({
    isHighAccuracyTrackingStarted: async () => true,
    stopHighAccuracyTracking: async () => { calls.push("stopTracking"); },
  });
  const controller = createBackgroundLocationController(driver);

  await assert.rejects(
    controller.handleGeofenceTransition("exit", undefined, async () => {
      calls.push("pausePersistedDocking");
      throw new Error("storage unavailable");
    }),
    /storage unavailable/,
  );

  assert.deepEqual(calls, ["pausePersistedDocking", "stopTracking"]);
});

test("boot geofence failure returns foreground-only fallback instead of rejecting", async () => {
  const helper = (locationControllerModule as unknown as {
    armSelectedPortWithForegroundFallback?: (
      arm: (region: SelectedPortRegion) => Promise<void>,
      region: SelectedPortRegion,
    ) => Promise<"background" | "foreground-only">;
  }).armSelectedPortWithForegroundFallback;
  assert.equal(typeof helper, "function");

  const result = await helper!(
    async () => { throw new Error("geofence unavailable"); },
    { portId: "port-2", latitude: 39.74, longitude: -104.99, radiusMeters: 120 },
  );

  assert.equal(result, "foreground-only");
});

test("boot geofence success keeps background navigation enabled", async () => {
  const helper = (locationControllerModule as unknown as {
    armSelectedPortWithForegroundFallback: (
      arm: (region: SelectedPortRegion) => Promise<void>,
      region: SelectedPortRegion,
    ) => Promise<"background" | "foreground-only">;
  }).armSelectedPortWithForegroundFallback;
  const armedPortIds: string[] = [];

  const result = await helper(
    async (region) => { armedPortIds.push(region.portId); },
    { portId: "port-3", latitude: 39.75, longitude: -104.98, radiusMeters: 120 },
  );

  assert.equal(result, "background");
  assert.deepEqual(armedPortIds, ["port-3"]);
});

test("geofence transition checks target currency only when its serialized turn begins", async () => {
  let releaseArm!: () => void;
  const armPending = new Promise<void>((resolve) => { releaseArm = resolve; });
  const { calls, driver } = fakeDriver({
    startGeofence: async () => { await armPending; },
  });
  const controller = createBackgroundLocationController(driver);
  const arm = controller.armSelectedPort({
    portId: "new-port", latitude: 39.7, longitude: -105, radiusMeters: 75,
  });
  const staleEnter = controller.handleGeofenceTransition("enter", async () => false);

  releaseArm();
  await Promise.all([arm, staleEnter]);

  assert.deepEqual(calls, []);
});

test("disarming stops high accuracy before removing geofence", async () => {
  const { calls, driver } = fakeDriver({
    isGeofenceStarted: async () => true,
    isHighAccuracyTrackingStarted: async () => true,
  });

  await createBackgroundLocationController(driver).disarmSelectedPort();

  assert.deepEqual(calls, ["stopTracking", "stopGeofence"]);
});

test("unavailable task manager fails without requesting permissions or registering tasks", async () => {
  const { calls, driver } = fakeDriver({ isAvailable: async () => false });
  const controller = createBackgroundLocationController(driver);

  await assert.rejects(controller.requestPermissions(), /not available/i);
  await assert.rejects(
    controller.armSelectedPort({ portId: "port-1", latitude: 1, longitude: 2, radiusMeters: 50 }),
    /not available/i,
  );
  assert.deepEqual(calls, []);
});
