import type { DockingCoordinator, DockingIssue } from "./dockingCoordinator.ts";
import type { DockingSession, DockingTarget } from "../docking.ts";
import { MAX_DOCKING_PROOF_ID_LENGTH } from "../game/engine.ts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is number | null {
  return value === null || nonNegativeInteger(value);
}

function issue(value: unknown): value is DockingIssue {
  return value === null || value === "poor-signal" || value === "unavailable";
}

function dockingPair(targetValue: unknown, sessionValue: unknown): {
  target: DockingTarget;
  session: DockingSession;
} | null {
  if (!record(targetValue) || !record(targetValue.coords) || !record(sessionValue)) return null;
  const targetId = targetValue.id;
  const latitude = targetValue.coords.latitude;
  const longitude = targetValue.coords.longitude;
  const sessionId = sessionValue.sessionId;
  if (
    typeof targetId !== "string"
    || !/^[A-Za-z0-9._-]{1,64}$/.test(targetId)
    || !finite(latitude)
    || latitude < -90
    || latitude > 90
    || !finite(longitude)
    || longitude < -180
    || longitude > 180
    || sessionValue.portId !== targetId
    || typeof sessionId !== "string"
    || !/^[a-z0-9-]{1,64}$/.test(sessionId)
    || (sessionValue.status !== "armed" && sessionValue.status !== "qualifying" && sessionValue.status !== "paused" && sessionValue.status !== "docked")
    || !nonNegativeInteger(sessionValue.qualifiedMs)
    || sessionValue.qualifiedMs < 0
    || sessionValue.qualifiedMs > 600_000
    || !timestamp(sessionValue.lastValidAt)
    || !timestamp(sessionValue.pausedAt)
  ) return null;

  let proof = null;
  if (sessionValue.proof !== null) {
    if (
      !record(sessionValue.proof)
      || typeof sessionValue.proof.id !== "string"
      || sessionValue.proof.id.length === 0
      || sessionValue.proof.id.length > MAX_DOCKING_PROOF_ID_LENGTH
      || sessionValue.proof.portId !== targetId
      || sessionValue.proof.sessionId !== sessionId
      || !timestamp(sessionValue.proof.completedAt)
      || sessionValue.proof.completedAt === null
      || sessionValue.proof.id !== `dock:${targetId}:${sessionValue.proof.completedAt}:${sessionId}`
    ) return null;
    proof = {
      id: sessionValue.proof.id,
      portId: targetId,
      completedAt: sessionValue.proof.completedAt,
      sessionId,
    };
  }
  const status = sessionValue.status;
  const qualifiedMs = sessionValue.qualifiedMs;
  const lastValidAt = sessionValue.lastValidAt;
  const pausedAt = sessionValue.pausedAt;
  const validState = (
    status === "armed"
    && qualifiedMs === 0
    && lastValidAt === null
    && pausedAt === null
    && proof === null
  ) || (
    status === "qualifying"
    && qualifiedMs >= 0
    && qualifiedMs < 600_000
    && lastValidAt !== null
    && pausedAt === null
    && proof === null
  ) || (
    status === "paused"
    && qualifiedMs >= 0
    && qualifiedMs < 600_000
    && lastValidAt === null
    && pausedAt !== null
    && proof === null
  ) || (
    status === "docked"
    && qualifiedMs === 600_000
    && proof !== null
    && ((lastValidAt !== null && pausedAt === null) || (lastValidAt === null && pausedAt !== null))
    && proof.completedAt <= (lastValidAt ?? pausedAt ?? -1)
  );
  if (!validState) return null;
  return {
    target: { id: targetId, coords: { latitude, longitude } },
    session: {
      portId: targetId,
      sessionId,
      status,
      qualifiedMs,
      lastValidAt,
      pausedAt,
      proof,
    },
  };
}

export function encodeDockingCoordinator(value: DockingCoordinator): string {
  const decoded = decodeDockingCoordinator(JSON.stringify({ version: 2, coordinator: value }));
  if (!decoded) throw new TypeError("Valid docking coordinator required");
  return JSON.stringify({ version: 2, coordinator: decoded });
}

export function decodeDockingCoordinator(raw: string | null | undefined): DockingCoordinator | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record(value) || value.version !== 2 || !record(value.coordinator)) return null;
  const coordinator = value.coordinator;
  const selected = dockingPair(coordinator.target, coordinator.session);
  const hasAuthorizedDock = coordinator.authorizedDock !== null && coordinator.authorizedDock !== undefined;
  const authorized = !hasAuthorizedDock
    ? null
    : record(coordinator.authorizedDock)
      ? dockingPair(coordinator.authorizedDock.target, coordinator.authorizedDock.session)
      : null;
  if (!selected) return null;
  const hasEarnedDock = coordinator.earnedDock !== null && coordinator.earnedDock !== undefined;
  const earned = !hasEarnedDock
    ? selected.session.proof
      ? selected
      : null
    : record(coordinator.earnedDock)
      ? dockingPair(coordinator.earnedDock.target, coordinator.earnedDock.session)
      : null;
  if (
    (hasAuthorizedDock && !authorized)
    || (hasAuthorizedDock && !hasEarnedDock)
    || (hasEarnedDock && !earned)
    || typeof coordinator.proofConsumed !== "boolean"
    || !issue(coordinator.lastIssue)
    || (earned !== null && earned.session.status !== "docked")
    || (coordinator.proofConsumed && !earned)
    || (authorized !== null && authorized.session.status !== "docked")
    || (authorized !== null && (
      !coordinator.proofConsumed
      || !earned
      || authorized.target.id !== earned.target.id
      || authorized.session.portId !== earned.session.portId
      || authorized.session.sessionId !== earned.session.sessionId
      || authorized.session.proof?.id !== earned.session.proof?.id
    ))
  ) return null;

  return {
    ...selected,
    earnedDock: earned,
    proofConsumed: coordinator.proofConsumed,
    authorizedDock: authorized,
    lastIssue: coordinator.lastIssue,
  };
}
