import {
  createDockingSession,
  updateDockingSession,
  type DockingSession,
  type DockingTarget,
  type LocationSample as DockingLocationSample,
} from "../docking.ts";
import { dock, revokeDocking, type GameState } from "../game/engine.ts";
import type { LocationSample } from "../location/types.ts";

export type DockingIssue = "poor-signal" | "unavailable" | null;

export type DockingCoordinator = {
  target: DockingTarget;
  session: DockingSession;
  /** Durable proof record, independent of live-session departure grace. */
  earnedDock: { target: DockingTarget; session: DockingSession } | null;
  proofConsumed: boolean;
  authorizedDock: { target: DockingTarget; session: DockingSession } | null;
  lastIssue: DockingIssue;
};

export type DockingViewModel = {
  phase: "armed" | "qualifying" | "paused" | "poor-signal" | "completed" | "departed";
  headline: string;
  detail: string;
  remainingMs: number;
  foregroundOnly: boolean;
};

const REQUIRED_QUALIFICATION_MS = 600_000;
const RECOVERY_GRACE_MS = 30_000;

export function createDockingCoordinator(target: DockingTarget): DockingCoordinator {
  return {
    target: { id: target.id, coords: { ...target.coords } },
    session: createDockingSession(target.id),
    earnedDock: null,
    proofConsumed: false,
    authorizedDock: null,
    lastIssue: null,
  };
}

export function selectDockingTarget(
  current: DockingCoordinator,
  target: DockingTarget,
): DockingCoordinator {
  if (current.target.id === target.id) return current;
  return {
    ...createDockingCoordinator(target),
    earnedDock: current.earnedDock ?? dockPair(current.target, current.session),
    authorizedDock: current.authorizedDock,
  };
}

function dockPair(
  target: DockingTarget,
  session: DockingSession,
): { target: DockingTarget; session: DockingSession } | null {
  return session.proof
    ? { target, session }
    : null;
}

export function acknowledgeDockingProof(
  current: DockingCoordinator,
  proofId: string,
): DockingCoordinator {
  const earned = current.earnedDock ?? dockPair(current.target, current.session);
  if (!earned || earned.session.proof?.id !== proofId || current.proofConsumed) return current;

  const departed = current.target.id === earned.target.id
    && (
      current.session.status !== "docked"
      || current.session.proof?.id !== proofId
    );
  return {
    ...current,
    proofConsumed: true,
    earnedDock: earned,
    authorizedDock: departed ? null : earned,
  };
}

function issueForSample(sample: LocationSample | null, observedAt: number): DockingIssue {
  if (sample === null) return "unavailable";
  const age = observedAt - sample.recordedAtMs;
  if (
    sample.isMocked
    || sample.horizontalAccuracyMeters === null
    || sample.horizontalAccuracyMeters < 0
    || sample.horizontalAccuracyMeters > 50
    || age < 0
    || age > 30_000
    || (sample.speedMetersPerSecond !== null && sample.speedMetersPerSecond > 2.5)
  ) {
    return "poor-signal";
  }
  return null;
}

function dockingSample(sample: LocationSample | null): DockingLocationSample | null {
  if (sample === null) return null;
  return {
    coords: { latitude: sample.latitude, longitude: sample.longitude },
    accuracy: sample.isMocked ? Number.POSITIVE_INFINITY : sample.horizontalAccuracyMeters ?? Number.NaN,
    speed: sample.speedMetersPerSecond,
    timestamp: sample.recordedAtMs,
  };
}

export function applyCoordinatorSample(
  current: DockingCoordinator,
  sample: LocationSample | null,
  observedAt: number,
): DockingCoordinator {
  const location = dockingSample(sample);
  const session = updateDockingSession(
    current.session,
    current.target,
    location,
    observedAt,
  );
  return {
    ...current,
    session,
    earnedDock: current.earnedDock ?? dockPair(current.target, session),
    authorizedDock: current.authorizedDock
      ? {
          ...current.authorizedDock,
          session: updateDockingSession(
            current.authorizedDock.session,
            current.authorizedDock.target,
            location,
            observedAt,
          ),
        }
      : null,
    lastIssue: issueForSample(sample, observedAt),
  };
}

export function consumeCompletedDocking(
  game: GameState,
  current: DockingCoordinator,
): { game: GameState; coordinator: DockingCoordinator } {
  const earned = current.earnedDock ?? dockPair(current.target, current.session);
  const proof = earned?.session.proof;
  if (!proof || !earned || current.proofConsumed) return { game, coordinator: current };
  const coordinator = acknowledgeDockingProof(current, proof.id);
  const consumedGame = game.consumedDockingProofIds.includes(proof.id)
    ? game
    : dock(game, earned.target.id, proof);
  return {
    game: coordinator.authorizedDock === null
      && consumedGame.dockedPortId === earned.target.id
      ? revokeDocking(consumedGame)
      : consumedGame,
    coordinator,
  };
}

/**
 * Repairs the historical torn-save order where coordinator consumption reached
 * storage before the game state did. Replaying this exact proof is idempotent.
 */
export function repairDockingCoordinatorForGame(
  game: GameState,
  current: DockingCoordinator,
): DockingCoordinator {
  const earned = current.earnedDock ?? dockPair(current.target, current.session);
  const proof = earned?.session.proof;
  if (!current.proofConsumed || !proof || game.consumedDockingProofIds.includes(proof.id)) {
    return current;
  }
  return { ...current, earnedDock: earned, proofConsumed: false, authorizedDock: null };
}

export function reconcileDepartedDock(
  game: GameState,
  current: DockingCoordinator,
): GameState {
  const departed = current.authorizedDock?.session.status === "paused";
  return departed && game.dockedPortId === current.authorizedDock?.target.id
    ? revokeDocking(game)
    : game;
}

export function dockingViewModel(
  current: DockingCoordinator,
  observedAt: number,
  foregroundOnly: boolean,
): DockingViewModel {
  const remainingMs = Math.max(0, REQUIRED_QUALIFICATION_MS - current.session.qualifiedMs);
  const common = { remainingMs, foregroundOnly };

  if (
    current.authorizedDock?.session.status === "paused"
    && current.authorizedDock.target.id === current.target.id
  ) {
    return {
      ...common,
      phase: "departed",
      headline: "DEPARTED",
      detail: "Docking link revoked after departure grace expired.",
    };
  }
  if (current.session.status === "docked" && current.session.pausedAt === null) {
    return {
      ...common,
      phase: "completed",
      headline: "DOCKING COMPLETE",
      detail: "Authenticated market link available while you remain nearby.",
    };
  }
  if (current.lastIssue === "poor-signal") {
    return {
      ...common,
      phase: "poor-signal",
      headline: "POOR SIGNAL",
      detail: "Location accuracy, freshness, or movement is outside docking limits.",
    };
  }
  if (current.session.pausedAt !== null) {
    const graceRemaining = Math.max(0, RECOVERY_GRACE_MS - (observedAt - current.session.pausedAt));
    return {
      ...common,
      phase: "paused",
      headline: "QUALIFICATION PAUSED",
      detail: `Signal recovery grace: ${Math.ceil(graceRemaining / 1_000)} seconds remaining.`,
    };
  }
  if (current.session.status === "qualifying") {
    return {
      ...common,
      phase: "qualifying",
      headline: "QUALIFYING APPROACH",
      detail: "Remain nearby, stationary, and within accuracy limits.",
    };
  }
  return {
    ...common,
    phase: "armed",
    headline: "APPROACH ARMED",
    detail: "Waiting for a qualifying location sample.",
  };
}
