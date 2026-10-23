import assert from "node:assert/strict";
import test from "node:test";

import {
  createDockingSession,
  updateDockingSession,
  type DockingSession,
  type DockingTarget,
  type LocationSample,
} from "../src/docking.ts";

const PORT: DockingTarget = {
  id: "port-alpha",
  coords: { latitude: 39.7392, longitude: -104.9903 },
};

function sample(timestamp: number, overrides: Partial<LocationSample> = {}): LocationSample {
  return {
    coords: PORT.coords,
    accuracy: 5,
    speed: 0,
    timestamp,
    ...overrides,
  };
}

function observe(
  session: DockingSession,
  at: number,
  location: LocationSample | null = sample(at),
  target: DockingTarget = PORT,
): DockingSession {
  return updateDockingSession(session, target, location, at);
}

test("session arms against one port without retaining location history", () => {
  const session = createDockingSession(PORT.id);

  assert.deepEqual({ ...session, sessionId: undefined }, {
    portId: "port-alpha",
    sessionId: undefined,
    status: "armed",
    qualifiedMs: 0,
    lastValidAt: null,
    pausedAt: null,
    proof: null,
  });
  assert.match(session.sessionId, /^[a-z0-9-]+$/);
  assert.equal("samples" in session, false);
  assert.equal("locations" in session, false);
});

test("only fresh, accurate, stationary samples wholly inside 120 metres qualify", () => {
  const invalidSamples: LocationSample[] = [
    sample(69_999),
    sample(100_000, { accuracy: 50.001 }),
    sample(100_000, { speed: -0.001 }),
    sample(100_000, { speed: 2.501 }),
    sample(100_000, {
      coords: { latitude: 39.740_099, longitude: -104.9903 },
      accuracy: 21,
    }),
  ];

  for (const location of invalidSamples) {
    const next = observe(createDockingSession(PORT.id), 100_000, location);
    assert.equal(next.status, "paused");
    assert.equal(next.qualifiedMs, 0);
  }

  const boundary = observe(
    createDockingSession(PORT.id),
    100_000,
    sample(70_000, { accuracy: 50, speed: null }),
  );
  assert.equal(boundary.status, "qualifying");
});

test("qualification counts capped intervals between consecutive valid samples", () => {
  let session = observe(createDockingSession(PORT.id), 0);
  session = observe(session, 10_000);
  session = observe(session, 30_000);

  assert.equal(session.status, "qualifying");
  assert.equal(session.qualifiedMs, 25_000);
});

test("a consecutive valid sample more than 30 seconds later restarts qualification", () => {
  let session = observe(createDockingSession(PORT.id), 0);
  session = observe(session, 30_001);

  assert.equal(session.status, "qualifying");
  assert.equal(session.qualifiedMs, 0);
});

test("an out-of-order sample pauses instead of rewinding the qualification clock", () => {
  let session = observe(createDockingSession(PORT.id), 0);
  session = observe(session, 10_000);
  session = observe(session, 20_000, sample(5_000));

  assert.equal(session.status, "paused");
  assert.equal(session.qualifiedMs, 10_000);
  assert.equal(session.lastValidAt, null);
});

test("an invalid or missing reading pauses without counting the gap", () => {
  let session = observe(createDockingSession(PORT.id), 0);
  session = observe(session, 15_000);
  session = observe(session, 20_000, null);
  session = observe(session, 40_000);
  session = observe(session, 50_000);

  assert.equal(session.status, "qualifying");
  assert.equal(session.qualifiedMs, 25_000);
});

test("a missing runtime sample pauses safely", () => {
  const next = updateDockingSession(
    createDockingSession(PORT.id),
    PORT,
    undefined as unknown as LocationSample,
    0,
  );

  assert.equal(next.status, "paused");
  assert.equal(next.qualifiedMs, 0);
});

test("recovery at 30 seconds preserves progress but later recovery resets it", () => {
  let preserved = observe(createDockingSession(PORT.id), 0);
  preserved = observe(preserved, 15_000);
  preserved = observe(preserved, 20_000, null);
  preserved = observe(preserved, 50_000);
  assert.equal(preserved.qualifiedMs, 15_000);

  let reset = observe(createDockingSession(PORT.id), 0);
  reset = observe(reset, 15_000);
  reset = observe(reset, 20_000, null);
  reset = observe(reset, 50_001);
  assert.equal(reset.status, "qualifying");
  assert.equal(reset.qualifiedMs, 0);
});

test("switching targets resets an incomplete qualification", () => {
  let session = observe(createDockingSession(PORT.id), 0);
  session = observe(session, 15_000);
  session = observe(
    session,
    20_000,
    sample(20_000, { coords: { latitude: 39.74, longitude: -104.99 } }),
    { id: "port-beta", coords: { latitude: 39.74, longitude: -104.99 } },
  );

  assert.equal(session.portId, "port-beta");
  assert.equal(session.status, "qualifying");
  assert.equal(session.qualifiedMs, 0);
});

test("599999 milliseconds does not dock; 600000 creates a port-bound proof", () => {
  let session = observe(createDockingSession(PORT.id), 0);
  for (let at = 15_000; at <= 585_000; at += 15_000) session = observe(session, at);
  session = observe(session, 599_999);

  assert.equal(session.qualifiedMs, 599_999);
  assert.equal(session.status, "qualifying");
  assert.equal(session.proof, null);

  session = observe(session, 600_000);
  assert.equal(session.qualifiedMs, 600_000);
  assert.equal(session.status, "docked");
  assert.equal(session.proof?.portId, "port-alpha");
  assert.equal(session.proof?.completedAt, 600_000);
  assert.match(session.proof?.id ?? "", /^dock:port-alpha:600000:[a-z0-9-]+$/);
});

test("independent same-port qualifications at the same timestamp receive distinct proof ids", () => {
  let first = createDockingSession(PORT.id);
  let second = createDockingSession(PORT.id);
  for (let at = 0; at <= 600_000; at += 15_000) {
    first = observe(first, at);
    second = observe(second, at);
  }

  assert.equal(first.proof?.completedAt, second.proof?.completedAt);
  assert.notEqual(first.proof?.id, second.proof?.id);
});

test("departure keeps docking proof through grace then pauses and revokes it", () => {
  let session = observe(createDockingSession(PORT.id), 0);
  for (let at = 15_000; at <= 600_000; at += 15_000) session = observe(session, at);

  session = observe(session, 610_000, null);
  session = observe(session, 640_000, null);
  assert.equal(session.status, "docked");
  assert.notEqual(session.proof, null);

  session = observe(session, 640_001, null);
  assert.equal(session.status, "paused");
  assert.equal(session.qualifiedMs, 0);
  assert.equal(session.proof, null);
});
