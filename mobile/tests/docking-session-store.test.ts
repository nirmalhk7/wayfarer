import assert from "node:assert/strict";
import test from "node:test";

import {
  createDockingSessionStore,
  shouldPersistForegroundSession,
  type StringStorage,
} from "../src/ui/dockingSessionStore.ts";

function memoryStorage(): StringStorage & { writes: string[] } {
  let value: string | null = null;
  const writes: string[] = [];
  return {
    writes,
    getItem: async () => value,
    setItem: async (_key, next) => {
      writes.push(next);
      value = next;
    },
  };
}

const TARGET = {
  id: "port-4",
  coords: { latitude: 39.7392, longitude: -104.9903 },
};

function sample(recordedAtMs: number) {
  return {
    latitude: TARGET.coords.latitude,
    longitude: TARGET.coords.longitude,
    horizontalAccuracyMeters: 5,
    altitudeMeters: null,
    verticalAccuracyMeters: null,
    headingDegrees: null,
    speedMetersPerSecond: 0,
    recordedAtMs,
    isMocked: false,
  };
}

test("background sample batch reduces and persists once without a location trail", async () => {
  const storage = memoryStorage();
  const store = createDockingSessionStore(storage, () => 15_000);
  await store.selectTarget(TARGET);
  storage.writes.length = 0;

  const state = await store.processSamples([sample(0), sample(15_000)]);

  assert.ok(state);
  assert.equal(state.session.qualifiedMs, 15_000);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].includes("recordedAtMs"), false);
  assert.equal(storage.writes[0].includes("samples"), false);
});

test("background processing is serialized so overlapping task deliveries cannot lose progress", async () => {
  const storage = memoryStorage();
  let now = 0;
  const store = createDockingSessionStore(storage, () => now);
  await store.selectTarget(TARGET);

  now = 15_000;
  const first = store.processSamples([sample(0), sample(15_000)]);
  now = 30_000;
  const second = store.processSamples([sample(30_000)]);
  await Promise.all([first, second]);

  const state = await store.load();
  assert.ok(state);
  assert.equal(state.session.qualifiedMs, 30_000);
});

test("samples are ignored safely until a selected target has been persisted", async () => {
  const storage = memoryStorage();
  const store = createDockingSessionStore(storage, () => 10_000);

  const state = await store.processSamples([sample(10_000)]);

  assert.equal(state, null);
  assert.equal(storage.writes.length, 0);
});

test("permission revocation explicitly pauses a persisted qualifying session", async () => {
  const storage = memoryStorage();
  let now = 15_000;
  const store = createDockingSessionStore(storage, () => now);
  await store.selectTarget(TARGET);
  await store.processSamples([sample(0), sample(15_000)]);

  now = 20_000;
  const state = await store.pause();

  assert.ok(state);
  assert.equal(state.session.status, "paused");
  assert.equal(state.session.pausedAt, 20_000);
  assert.equal(state.session.qualifiedMs, 15_000);
});

test("one delivery timestamp validates an entire background batch consistently", async () => {
  const storage = memoryStorage();
  let clockCalls = 0;
  const store = createDockingSessionStore(storage, () => {
    clockCalls += 1;
    return 20_000 + clockCalls * 20_000;
  });
  await store.selectTarget(TARGET);
  clockCalls = 0;

  const state = await store.processSamples([sample(15_000), sample(30_000)]);

  assert.ok(state);
  assert.equal(clockCalls, 1);
  assert.equal(state.session.status, "qualifying");
  assert.equal(state.session.qualifiedMs, 15_000);
});

test("foreground samples coalesce routine qualification writes but preserve completion immediately", async () => {
  const storage = memoryStorage();
  let now = 0;
  const store = createDockingSessionStore(storage, () => now);
  await store.selectTarget(TARGET);
  storage.writes.length = 0;

  await store.processForegroundSamples([sample(0)]);
  now = 3_000;
  await store.processForegroundSamples([sample(3_000)]);
  now = 6_000;
  await store.processForegroundSamples([sample(6_000)]);

  assert.equal(storage.writes.length, 1);
  assert.equal(shouldPersistForegroundSession(0, 3_000, false), false);
  assert.equal(shouldPersistForegroundSession(0, 3_000, true), true);
});

test("proof acknowledgment is a separate durable step after the game save", async () => {
  const storage = memoryStorage();
  let now = 0;
  const store = createDockingSessionStore(storage, () => now);
  await store.selectTarget(TARGET);
  let completed = null;
  for (let at = 0; at <= 600_000; at += 15_000) {
    now = at;
    completed = await store.processSamples([sample(at)]);
  }
  assert.ok(completed?.earnedDock?.session.proof);

  const acknowledged = await store.acknowledgePersistedProof(completed.earnedDock.session.proof.id);

  assert.equal(acknowledged?.proofConsumed, true);
  assert.equal((await store.load())?.proofConsumed, true);
});

test("proof acknowledgment cannot restore authorization after persisted departure", async () => {
  const storage = memoryStorage();
  let now = 0;
  const store = createDockingSessionStore(storage, () => now);
  await store.selectTarget(TARGET);
  let completed = null;
  for (let at = 0; at <= 600_000; at += 15_000) {
    now = at;
    completed = await store.processSamples([sample(at)]);
  }
  assert.ok(completed?.earnedDock?.session.proof);

  now = 600_001;
  await store.pause();
  now = 630_002;
  await store.pause();
  const acknowledged = await store.acknowledgePersistedProof(completed.earnedDock.session.proof.id);

  assert.equal(acknowledged?.proofConsumed, true);
  assert.equal(acknowledged?.authorizedDock, null);
});
