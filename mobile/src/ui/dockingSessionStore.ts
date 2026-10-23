import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DockingTarget } from "../docking.ts";
import type { LocationSample } from "../location/types.ts";
import {
  acknowledgeDockingProof,
  applyCoordinatorSample,
  createDockingCoordinator,
  selectDockingTarget,
  type DockingCoordinator,
} from "./dockingCoordinator.ts";
import { decodeDockingCoordinator, encodeDockingCoordinator } from "./dockingSessionCodec.ts";

export const DOCKING_SESSION_STORAGE_KEY = "wayfarer.mobile.docking-session.v1";
const FOREGROUND_PERSIST_INTERVAL_MS = 15_000;

export type StringStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function shouldPersistForegroundSession(
  lastPersistedAt: number | null,
  observedAt: number,
  immediatelyImportant: boolean,
): boolean {
  return immediatelyImportant
    || lastPersistedAt === null
    || observedAt - lastPersistedAt >= FOREGROUND_PERSIST_INTERVAL_MS;
}

export function createDockingSessionStore(
  storage: StringStorage,
  clock: () => number = Date.now,
) {
  let queue: Promise<unknown> = Promise.resolve();
  let cached: DockingCoordinator | null | undefined;
  let lastForegroundPersistedAt: number | null = null;

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  }

  async function read(): Promise<DockingCoordinator | null> {
    if (cached !== undefined) return cached;
    cached = decodeDockingCoordinator(await storage.getItem(DOCKING_SESSION_STORAGE_KEY));
    return cached;
  }

  async function write(
    state: DockingCoordinator,
    persistedAt: number = clock(),
  ): Promise<DockingCoordinator> {
    await storage.setItem(DOCKING_SESSION_STORAGE_KEY, encodeDockingCoordinator(state));
    cached = state;
    lastForegroundPersistedAt = persistedAt;
    return state;
  }

  return {
    load: () => serialized(read),
    save: (state: DockingCoordinator) => serialized(() => write(state)),
    selectTarget: (target: DockingTarget) => serialized(async () => {
      const current = await read();
      return write(current ? selectDockingTarget(current, target) : createDockingCoordinator(target));
    }),
    processSamples: (samples: readonly LocationSample[]) => serialized(async () => {
      let current = await read();
      if (!current || samples.length === 0) return current;
      const observedAt = clock();
      for (const sample of samples) {
        current = applyCoordinatorSample(current, sample, observedAt);
      }
      return write(current, observedAt);
    }),
    processForegroundSamples: (samples: readonly LocationSample[]) => serialized(async () => {
      let current = await read();
      if (!current || samples.length === 0) return current;
      const observedAt = clock();
      const before = current;
      for (const sample of samples) {
        current = applyCoordinatorSample(current, sample, observedAt);
      }
      cached = current;
      const immediatelyImportant = before.session.status !== current.session.status
        || before.session.proof?.id !== current.session.proof?.id
        || before.earnedDock?.session.proof?.id !== current.earnedDock?.session.proof?.id;
      return shouldPersistForegroundSession(lastForegroundPersistedAt, observedAt, immediatelyImportant)
        ? write(current, observedAt)
        : current;
    }),
    acknowledgePersistedProof: (proofId: string) => serialized(async () => {
      const current = await read();
      if (!current) return current;
      const acknowledged = acknowledgeDockingProof(current, proofId);
      return acknowledged === current ? current : write(acknowledged);
    }),
    pause: () => serialized(async () => {
      const current = await read();
      const observedAt = clock();
      return current ? write(applyCoordinatorSample(current, null, observedAt), observedAt) : null;
    }),
  };
}

const persistedStore = createDockingSessionStore(AsyncStorage);
const listeners = new Set<(state: DockingCoordinator) => void>();

function publish(state: DockingCoordinator | null): DockingCoordinator | null {
  if (state) {
    for (const listener of listeners) listener(state);
  }
  return state;
}

export async function processPersistedBackgroundSamples(
  samples: readonly LocationSample[],
): Promise<DockingCoordinator | null> {
  return publish(await persistedStore.processSamples(samples));
}

export async function processPersistedForegroundSamples(
  samples: readonly LocationSample[],
): Promise<DockingCoordinator | null> {
  return publish(await persistedStore.processForegroundSamples(samples));
}

export async function pausePersistedDockingCoordinator(): Promise<DockingCoordinator | null> {
  return publish(await persistedStore.pause());
}

export async function loadPersistedDockingCoordinator(): Promise<DockingCoordinator | null> {
  return persistedStore.load();
}

export async function persistDockingCoordinator(
  state: DockingCoordinator,
): Promise<DockingCoordinator> {
  return publish(await persistedStore.save(state))!;
}

/** Call only after the corresponding GameState save has resolved. */
export async function acknowledgePersistedDockingProof(
  proofId: string,
): Promise<DockingCoordinator | null> {
  return publish(await persistedStore.acknowledgePersistedProof(proofId));
}

export async function persistSelectedDockingTarget(
  target: DockingTarget,
): Promise<DockingCoordinator> {
  return publish(await persistedStore.selectTarget(target))!;
}

export function subscribeToDockingCoordinator(
  listener: (state: DockingCoordinator) => void,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
