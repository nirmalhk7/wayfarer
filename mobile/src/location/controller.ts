import type {
  BackgroundLocationPermissions,
  BackgroundLocationStatus,
  GeofenceTransition,
  PermissionState,
  SelectedPortRegion,
} from "./types.ts";

export type { SelectedPortRegion } from "./types.ts";

export interface BackgroundLocationDriver {
  isAvailable(): Promise<boolean>;
  getForegroundPermission(): Promise<PermissionState>;
  getBackgroundPermission(): Promise<PermissionState>;
  requestForegroundPermission(): Promise<PermissionState>;
  requestBackgroundPermission(): Promise<PermissionState>;
  isGeofenceStarted(): Promise<boolean>;
  startGeofence(regions: readonly SelectedPortRegion[]): Promise<void>;
  stopGeofence(): Promise<void>;
  isHighAccuracyTrackingStarted(): Promise<boolean>;
  startHighAccuracyTracking(): Promise<void>;
  stopHighAccuracyTracking(): Promise<void>;
}

export type BackgroundLocationErrorCode =
  | "unavailable"
  | "permission-denied"
  | "invalid-region";

export type GeofenceTransitionGuard = () => Promise<boolean>;
export type GeofenceExitHook = () => Promise<void>;

export class BackgroundLocationError extends Error {
  readonly code: BackgroundLocationErrorCode;

  constructor(code: BackgroundLocationErrorCode, message: string) {
    super(message);
    this.name = "BackgroundLocationError";
    this.code = code;
  }
}

function validateRegion(region: SelectedPortRegion): void {
  if (!region.portId.trim()) {
    throw new BackgroundLocationError("invalid-region", "Selected port id is required");
  }
  if (!Number.isFinite(region.latitude) || region.latitude < -90 || region.latitude > 90) {
    throw new BackgroundLocationError("invalid-region", "Selected port latitude is invalid");
  }
  if (!Number.isFinite(region.longitude) || region.longitude < -180 || region.longitude > 180) {
    throw new BackgroundLocationError("invalid-region", "Selected port longitude is invalid");
  }
  if (!Number.isFinite(region.radiusMeters) || region.radiusMeters <= 0) {
    throw new BackgroundLocationError("invalid-region", "Selected port radius must be positive");
  }
}

export async function armSelectedPortWithForegroundFallback(
  arm: (region: SelectedPortRegion) => Promise<void>,
  region: SelectedPortRegion,
): Promise<"background" | "foreground-only"> {
  try {
    await arm(region);
    return "background";
  } catch {
    return "foreground-only";
  }
}

export function createBackgroundLocationController(driver: BackgroundLocationDriver) {
  let operationQueue: Promise<void> = Promise.resolve();

  function enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const next = operationQueue.then(operation);
    operationQueue = next.catch(() => undefined);
    return next;
  }

  async function ensureAvailable(): Promise<void> {
    if (!await driver.isAvailable()) {
      throw new BackgroundLocationError(
        "unavailable",
        "Background location is not available in this build",
      );
    }
  }

  async function permissions(): Promise<BackgroundLocationPermissions> {
    const [foreground, background] = await Promise.all([
      driver.getForegroundPermission(),
      driver.getBackgroundPermission(),
    ]);
    return { foreground, background };
  }

  async function requirePermissions(): Promise<void> {
    const current = await permissions();
    if (current.foreground !== "granted" || current.background !== "granted") {
      throw new BackgroundLocationError(
        "permission-denied",
        "Foreground and background location permissions are required",
      );
    }
  }

  async function requestPermissions(): Promise<BackgroundLocationPermissions> {
    await ensureAvailable();
    const foreground = await driver.requestForegroundPermission();
    if (foreground !== "granted") return { foreground, background: "denied" };
    const background = await driver.requestBackgroundPermission();
    return { foreground, background };
  }

  async function armSelectedPortNow(region: SelectedPortRegion): Promise<void> {
    await ensureAvailable();
    validateRegion(region);
    await requirePermissions();
    // Tracking belongs to the previous target; wait for the new target's entry event.
    await stopHighAccuracyTracking();
    // Calling Expo's startGeofencingAsync again replaces the registered region list.
    await driver.startGeofence([{ ...region, portId: region.portId.trim() }]);
  }

  function armSelectedPort(region: SelectedPortRegion): Promise<void> {
    return enqueueOperation(() => armSelectedPortNow(region));
  }

  async function startHighAccuracyTracking(): Promise<void> {
    await ensureAvailable();
    await requirePermissions();
    if (!await driver.isHighAccuracyTrackingStarted()) {
      await driver.startHighAccuracyTracking();
    }
  }

  async function stopHighAccuracyTracking(): Promise<void> {
    if (await driver.isHighAccuracyTrackingStarted()) {
      await driver.stopHighAccuracyTracking();
    }
  }

  function handleGeofenceTransition(
    transition: GeofenceTransition,
    guard?: GeofenceTransitionGuard,
    beforeExit?: GeofenceExitHook,
  ): Promise<void> {
    return enqueueOperation(async () => {
      if (guard && !await guard()) return;
      if (transition === "enter") await startHighAccuracyTracking();
      else {
        try {
          await beforeExit?.();
        } finally {
          await stopHighAccuracyTracking();
        }
      }
    });
  }

  async function disarmSelectedPortNow(): Promise<void> {
    await ensureAvailable();
    await stopHighAccuracyTracking();
    if (await driver.isGeofenceStarted()) await driver.stopGeofence();
  }

  function disarmSelectedPort(): Promise<void> {
    return enqueueOperation(disarmSelectedPortNow);
  }

  async function status(): Promise<BackgroundLocationStatus> {
    const available = await driver.isAvailable();
    if (!available) {
      return {
        available: false,
        permissions: { foreground: "undetermined", background: "undetermined" },
        geofenceArmed: false,
        highAccuracyTracking: false,
      };
    }
    const [currentPermissions, geofenceArmed, highAccuracyTracking] = await Promise.all([
      permissions(),
      driver.isGeofenceStarted(),
      driver.isHighAccuracyTrackingStarted(),
    ]);
    return { available, permissions: currentPermissions, geofenceArmed, highAccuracyTracking };
  }

  return {
    armSelectedPort,
    disarmSelectedPort,
    handleGeofenceTransition,
    requestPermissions,
    startHighAccuracyTracking,
    status,
    stopHighAccuracyTracking,
  };
}
