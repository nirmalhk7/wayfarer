import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeDockingCoordinator,
  encodeDockingCoordinator,
} from "../src/ui/dockingSessionCodec.ts";
import { createDockingCoordinator } from "../src/ui/dockingCoordinator.ts";

const TARGET = {
  id: "port-3",
  coords: { latitude: 39.75, longitude: -104.98 },
};

test("coordinator codec persists bounded session metadata and never a location trail", () => {
  const state = createDockingCoordinator(TARGET);
  const encoded = encodeDockingCoordinator(state);
  const decoded = decodeDockingCoordinator(encoded);

  assert.deepEqual(decoded, state);
  assert.equal(encoded.includes("samples"), false);
  assert.equal(encoded.includes("history"), false);
  assert.equal(encoded.includes("recordedAtMs"), false);
});

test("coordinator codec rejects corrupt, mismatched, and unsupported records", () => {
  assert.equal(decodeDockingCoordinator(null), null);
  assert.equal(decodeDockingCoordinator("{"), null);
  assert.equal(decodeDockingCoordinator(JSON.stringify({ version: 99 })), null);

  const valid = JSON.parse(encodeDockingCoordinator(createDockingCoordinator(TARGET)));
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: {
      ...valid.coordinator,
      session: { ...valid.coordinator.session, portId: "different" },
    },
  })), null);
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: {
      ...valid.coordinator,
      session: { ...valid.coordinator.session, qualifiedMs: 900_000 },
    },
  })), null);
});

test("coordinator codec rejects semantically impossible sessions and forged proofs", () => {
  const valid = JSON.parse(encodeDockingCoordinator(createDockingCoordinator(TARGET)));
  const invalidSessions = [
    { ...valid.coordinator.session, status: "armed", qualifiedMs: 1 },
    { ...valid.coordinator.session, status: "qualifying", qualifiedMs: 0, lastValidAt: null },
    {
      ...valid.coordinator.session,
      status: "docked",
      qualifiedMs: 600_000,
      lastValidAt: 600_000,
      proof: { id: "dock:port-3:600000:forged", portId: "port-3", completedAt: 599_999 },
    },
    {
      ...valid.coordinator.session,
      status: "docked",
      qualifiedMs: 599_999,
      lastValidAt: 600_000,
      proof: { id: "dock:port-3:600000:forged", portId: "port-3", completedAt: 600_000 },
    },
  ];

  for (const session of invalidSessions) {
    assert.equal(decodeDockingCoordinator(JSON.stringify({
      ...valid,
      coordinator: { ...valid.coordinator, session },
    })), null);
  }
});

test("coordinator codec rejects consumed or authorized states without a valid earned proof", () => {
  const valid = JSON.parse(encodeDockingCoordinator(createDockingCoordinator(TARGET)));

  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: { ...valid.coordinator, proofConsumed: true },
  })), null);
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: {
      ...valid.coordinator,
      authorizedDock: {
        target: valid.coordinator.target,
        session: valid.coordinator.session,
      },
    },
  })), null);
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: {
      ...valid.coordinator,
      earnedDock: {
        target: valid.coordinator.target,
        session: valid.coordinator.session,
      },
    },
  })), null);
});

test("coordinator codec rejects authorization that is not the consumed earned proof", () => {
  const valid = JSON.parse(encodeDockingCoordinator(createDockingCoordinator(TARGET)));
  const proofSession = {
    ...valid.coordinator.session,
    status: "docked",
    qualifiedMs: 600_000,
    lastValidAt: 600_000,
    proof: {
      id: `dock:${TARGET.id}:600000:${valid.coordinator.session.sessionId}`,
      portId: TARGET.id,
      completedAt: 600_000,
      sessionId: valid.coordinator.session.sessionId,
    },
  };
  const earnedDock = { target: valid.coordinator.target, session: proofSession };
  const coordinator = {
    ...valid.coordinator,
    session: proofSession,
    earnedDock,
    proofConsumed: true,
    authorizedDock: earnedDock,
  };

  assert.ok(decodeDockingCoordinator(JSON.stringify({ ...valid, coordinator })));
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: { ...coordinator, proofConsumed: false },
  })), null);
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: { ...coordinator, earnedDock: null },
  })), null);
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: {
      ...coordinator,
      authorizedDock: {
        ...earnedDock,
        target: { ...earnedDock.target, id: "port-other" },
      },
    },
  })), null);
});

test("coordinator codec rejects a proof ID longer than the engine accepts", () => {
  const valid = JSON.parse(encodeDockingCoordinator(createDockingCoordinator(TARGET)));
  const target = { ...valid.coordinator.target, id: "p".repeat(64) };
  const sessionId = "a".repeat(64);
  const session = {
    ...valid.coordinator.session,
    portId: target.id,
    sessionId,
    status: "docked",
    qualifiedMs: 600_000,
    lastValidAt: 600_000,
    proof: {
      id: `dock:${target.id}:600000:${sessionId}`,
      portId: target.id,
      completedAt: 600_000,
      sessionId,
    },
  };

  assert.ok(session.proof.id.length > 96);
  assert.equal(decodeDockingCoordinator(JSON.stringify({
    ...valid,
    coordinator: { ...valid.coordinator, target, session },
  })), null);
});
