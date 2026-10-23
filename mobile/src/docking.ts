export type DockingCoordinates = {
  latitude: number;
  longitude: number;
};

export type LocationSample = {
  coords: DockingCoordinates;
  accuracy: number;
  speed?: number | null;
  timestamp: number;
};

export type DockingTarget = {
  id: string;
  coords: DockingCoordinates;
};

export type DockingProof = {
  id: string;
  portId: string;
  completedAt: number;
  sessionId: string;
};

export type DockingSession = {
  portId: string;
  sessionId: string;
  status: "armed" | "qualifying" | "paused" | "docked";
  qualifiedMs: number;
  lastValidAt: number | null;
  pausedAt: number | null;
  proof: DockingProof | null;
};

const MAX_SAMPLE_AGE_MS = 30_000;
const MAX_ACCURACY_METERS = 50;
const MAX_SPEED_METERS_PER_SECOND = 2.5;
const MAX_DOCKING_DISTANCE_METERS = 120;
const MAX_COUNTED_INTERVAL_MS = 15_000;
const RECOVERY_GRACE_MS = 30_000;
const REQUIRED_QUALIFICATION_MS = 600_000;
const EARTH_RADIUS_METERS = 6_371_000;
let createdSessionCount = 0;

function createSessionId(): string {
  createdSessionCount += 1;
  return `${Date.now().toString(36)}-${createdSessionCount.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDockingSession(portId: string): DockingSession {
  return {
    portId,
    sessionId: createSessionId(),
    status: "armed",
    qualifiedMs: 0,
    lastValidAt: null,
    pausedAt: null,
    proof: null,
  };
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function distanceMeters(a: DockingCoordinates, b: DockingCoordinates): number {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const startLatitude = radians(a.latitude);
  const endLatitude = radians(b.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function validSample(sample: LocationSample | null, target: DockingTarget, observedAt: number): sample is LocationSample {
  if (!sample) return false;
  const age = observedAt - sample.timestamp;
  const coordinatesValid = Number.isFinite(sample.coords?.latitude)
    && Number.isFinite(sample.coords?.longitude)
    && Number.isFinite(target.coords?.latitude)
    && Number.isFinite(target.coords?.longitude);
  const accuracyValid = Number.isFinite(sample.accuracy)
    && sample.accuracy >= 0
    && sample.accuracy <= MAX_ACCURACY_METERS;
  const speedValid = sample.speed === undefined
    || sample.speed === null
    || (Number.isFinite(sample.speed)
      && sample.speed >= 0
      && sample.speed <= MAX_SPEED_METERS_PER_SECOND);

  return coordinatesValid
    && Number.isFinite(age)
    && age >= 0
    && age <= MAX_SAMPLE_AGE_MS
    && accuracyValid
    && speedValid
    && distanceMeters(sample.coords, target.coords) + sample.accuracy <= MAX_DOCKING_DISTANCE_METERS;
}

function pauseSession(session: DockingSession, observedAt: number): DockingSession {
  const pausedAt = session.pausedAt ?? observedAt;
  const graceExpired = observedAt - pausedAt > RECOVERY_GRACE_MS;

  if (session.status === "docked" && !graceExpired) {
    return { ...session, pausedAt, lastValidAt: null };
  }

  return {
    ...session,
    status: "paused",
    qualifiedMs: graceExpired ? 0 : session.qualifiedMs,
    lastValidAt: null,
    pausedAt,
    proof: graceExpired ? null : session.proof,
  };
}

export function updateDockingSession(
  current: DockingSession,
  target: DockingTarget,
  sample: LocationSample | null,
  observedAt: number,
): DockingSession {
  const session = current.portId === target.id ? current : createDockingSession(target.id);

  if (
    !validSample(sample, target, observedAt)
    || (session.lastValidAt !== null && sample.timestamp < session.lastValidAt)
  ) {
    return pauseSession(session, observedAt);
  }

  if (session.status === "docked") {
    return { ...session, lastValidAt: sample.timestamp, pausedAt: null };
  }

  const recoveredAfterGrace = session.pausedAt !== null
    && observedAt - session.pausedAt > RECOVERY_GRACE_MS;
  const qualificationGapExceeded = session.lastValidAt !== null
    && sample.timestamp - session.lastValidAt > MAX_SAMPLE_AGE_MS;
  const startingQualifiedMs = recoveredAfterGrace || qualificationGapExceeded ? 0 : session.qualifiedMs;
  const interval = session.lastValidAt === null
    ? 0
    : qualificationGapExceeded
      ? 0
      : Math.min(MAX_COUNTED_INTERVAL_MS, Math.max(0, sample.timestamp - session.lastValidAt));
  const qualifiedMs = Math.min(REQUIRED_QUALIFICATION_MS, startingQualifiedMs + interval);

  if (qualifiedMs < REQUIRED_QUALIFICATION_MS) {
    return {
      ...session,
      status: "qualifying",
      qualifiedMs,
      lastValidAt: sample.timestamp,
      pausedAt: null,
      proof: null,
    };
  }

  const completedAt = sample.timestamp - (startingQualifiedMs + interval - REQUIRED_QUALIFICATION_MS);
  const proof: DockingProof = {
    id: `dock:${target.id}:${completedAt}:${session.sessionId}`,
    portId: target.id,
    completedAt,
    sessionId: session.sessionId,
  };
  return {
    ...session,
    status: "docked",
    qualifiedMs,
    lastValidAt: sample.timestamp,
    pausedAt: null,
    proof,
  };
}
