import assert from "node:assert/strict";
import test from "node:test";

import * as taskLifecycleModule from "../src/location/taskLifecycle.ts";

test("high-accuracy task errors attempt a durable qualification pause", async () => {
  const lifecycle = await import("../src/location/taskLifecycle.ts").catch(() => null);
  assert.ok(lifecycle, "location task lifecycle helper must exist");

  let pauseAttempts = 0;
  const paused = await lifecycle.pauseQualificationAfterLocationError(async () => {
    pauseAttempts += 1;
  });

  assert.equal(paused, true);
  assert.equal(pauseAttempts, 1);
});

test("high-accuracy task error handling remains non-throwing when pause storage fails", async () => {
  const lifecycle = await import("../src/location/taskLifecycle.ts").catch(() => null);
  assert.ok(lifecycle, "location task lifecycle helper must exist");

  let pauseAttempts = 0;
  const paused = await lifecycle.pauseQualificationAfterLocationError(async () => {
    pauseAttempts += 1;
    throw new Error("storage unavailable");
  });

  assert.equal(paused, false);
  assert.equal(pauseAttempts, 1);
});

test("adapter failure attempts a pause before returning a task failure", async () => {
  const runTask = (taskLifecycleModule as unknown as {
    processHighAccuracyTaskData?: <T>(operations: {
      decode: () => readonly T[];
      persist: (samples: readonly T[]) => Promise<void>;
      emit: (samples: readonly T[]) => void;
      pause: () => Promise<unknown>;
    }) => Promise<{ status: string; stage?: string; pausePersisted?: boolean }>;
  }).processHighAccuracyTaskData;
  assert.equal(typeof runTask, "function");
  let pauseAttempts = 0;

  const result = await runTask!({
    decode: () => { throw new Error("malformed task payload"); },
    persist: async () => undefined,
    emit: () => undefined,
    pause: async () => { pauseAttempts += 1; },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.stage, "decode");
  assert.equal(result.pausePersisted, true);
  assert.match(String((result as { error?: unknown }).error), /malformed task payload/);
  assert.equal(pauseAttempts, 1);
});

test("coordinator persistence failure does not recursively retry the same storage pause", async () => {
  const runTask = (taskLifecycleModule as unknown as {
    processHighAccuracyTaskData?: <T>(operations: {
      decode: () => readonly T[];
      persist: (samples: readonly T[]) => Promise<void>;
      emit: (samples: readonly T[]) => void;
      pause: () => Promise<unknown>;
    }) => Promise<{ status: string; stage?: string; pausePersisted?: boolean }>;
  }).processHighAccuracyTaskData;
  assert.equal(typeof runTask, "function");
  let pauseAttempts = 0;
  let emitCalls = 0;

  const result = await runTask!({
    decode: () => ["sample"],
    persist: async () => { throw new Error("AsyncStorage unavailable"); },
    emit: () => { emitCalls += 1; },
    pause: async () => { pauseAttempts += 1; },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.stage, "persist");
  assert.equal(result.pausePersisted, false);
  assert.match(String((result as { error?: unknown }).error), /AsyncStorage unavailable/);
  assert.equal(pauseAttempts, 0);
  assert.equal(emitCalls, 0);
});
