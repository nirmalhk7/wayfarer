export async function pauseQualificationAfterLocationError(
  pause: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await pause();
    return true;
  } catch {
    return false;
  }
}

export type HighAccuracyTaskDataResult =
  | { status: "empty" | "processed" }
  | {
      status: "failed";
      stage: "decode" | "persist" | "emit";
      pausePersisted: boolean;
      error: unknown;
    };

export async function processHighAccuracyTaskData<T>(operations: {
  decode: () => readonly T[];
  persist: (samples: readonly T[]) => Promise<unknown>;
  emit: (samples: readonly T[]) => void;
  pause: () => Promise<unknown>;
}): Promise<HighAccuracyTaskDataResult> {
  let samples: readonly T[];
  try {
    samples = operations.decode();
  } catch (error) {
    return {
      status: "failed",
      stage: "decode",
      pausePersisted: await pauseQualificationAfterLocationError(operations.pause),
      error,
    };
  }
  if (samples.length === 0) return { status: "empty" };

  try {
    await operations.persist(samples);
  } catch (error) {
    // The persistence operation and pause share the same serialized storage.
    // Retrying it as a pause is futile and can only add more failing writes.
    return { status: "failed", stage: "persist", pausePersisted: false, error };
  }

  try {
    operations.emit(samples);
  } catch (error) {
    return {
      status: "failed",
      stage: "emit",
      pausePersisted: await pauseQualificationAfterLocationError(operations.pause),
      error,
    };
  }
  return { status: "processed" };
}
