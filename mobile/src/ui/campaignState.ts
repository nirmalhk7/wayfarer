import type { GameState, Starport } from "../game/engine.ts";
import type { CampaignMode } from "../persistence.ts";
import {
  consumeCompletedDocking,
  reconcileDepartedDock,
  type DockingCoordinator,
} from "./dockingCoordinator.ts";

export type Campaigns = Record<CampaignMode, GameState>;

/** Serializes storage and coalesces superseded snapshots while a write is in flight. */
export function createLatestWriteQueue<T>(write: (snapshot: T) => Promise<void>) {
  let running = false;
  type WriteJob = {
    snapshot: T;
    barrier: boolean;
    resolve: () => void;
    reject: (error: unknown) => void;
  };
  const jobs: WriteJob[] = [];

  async function drain(): Promise<void> {
    while (jobs.length > 0) {
      const job = jobs.shift()!;
      try {
        await write(job.snapshot);
        job.resolve();
      } catch (error) {
        job.reject(error);
      }
    }
    running = false;
  }

  function enqueue(snapshot: T, barrier: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const job = { snapshot, barrier, resolve, reject };
      const last = jobs.at(-1);
      // Routine saves can collapse only with an adjacent routine save. A
      // barrier represents a caller-owned durable state transition, so a
      // later snapshot must wait behind it rather than resolve it early.
      if (!barrier && last && !last.barrier) {
        last.resolve();
        jobs[jobs.length - 1] = job;
      } else {
        jobs.push(job);
      }
      if (!running) {
        running = true;
        void drain();
      }
    });
  }

  return {
    schedule: (snapshot: T) => enqueue(snapshot, false),
    /** Persists this exact snapshot before resolving; it cannot be coalesced. */
    writeThrough: (snapshot: T) => enqueue(snapshot, true),
  };
}

export function updateCampaign(
  campaigns: Campaigns,
  mode: CampaignMode,
  update: (game: GameState) => GameState,
): Campaigns {
  return { ...campaigns, [mode]: update(campaigns[mode]) };
}

/** Derives both sides of a coordinator event before either reaches React state. */
export function resolveCoordinatorTransition(
  game: GameState,
  current: DockingCoordinator,
): { game: GameState; coordinator: DockingCoordinator; proofId: string | null } {
  const consumed = consumeCompletedDocking(game, current);
  const reconciled = reconcileDepartedDock(consumed.game, consumed.coordinator);
  const proofId = consumed.coordinator === current
    ? null
    : consumed.coordinator.earnedDock?.session.proof?.id ?? null;
  return { game: reconciled, coordinator: consumed.coordinator, proofId };
}

export function activeDockedPort(
  game: GameState,
  coordinator: DockingCoordinator,
): Starport | null {
  if (
    game.dockedPortId === null
    || coordinator.authorizedDock?.target.id !== game.dockedPortId
    || coordinator.authorizedDock.session.portId !== game.dockedPortId
    || coordinator.authorizedDock.session.status !== "docked"
  ) {
    return null;
  }
  return game.ports.find((port) => port.id === game.dockedPortId) ?? null;
}
