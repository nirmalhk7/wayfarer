import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { selectedPortRegionIdentifier } from "./adapter.ts";
import { HIGH_ACCURACY_LOCATION_TASK_NAME, SELECTED_PORT_GEOFENCE_TASK_NAME } from "./constants.ts";
import {
  createBackgroundLocationController,
  type BackgroundLocationDriver,
} from "./controller.ts";
import type { LocationSample, PermissionState, SelectedPortRegion } from "./types.ts";

export type BackgroundLocationSampleListener = (sample: LocationSample) => void;

const sampleListeners = new Set<BackgroundLocationSampleListener>();

function permissionState(status: unknown): PermissionState {
  if (status === "granted" || status === "denied") return status;
  return "undetermined";
}

const expoBackgroundLocationDriver: BackgroundLocationDriver = {
  isAvailable: () => TaskManager.isAvailableAsync(),
  getForegroundPermission: async () => permissionState(
    (await Location.getForegroundPermissionsAsync()).status,
  ),
  getBackgroundPermission: async () => permissionState(
    (await Location.getBackgroundPermissionsAsync()).status,
  ),
  requestForegroundPermission: async () => permissionState(
    (await Location.requestForegroundPermissionsAsync()).status,
  ),
  requestBackgroundPermission: async () => permissionState(
    (await Location.requestBackgroundPermissionsAsync()).status,
  ),
  isGeofenceStarted: () => Location.hasStartedGeofencingAsync(
    SELECTED_PORT_GEOFENCE_TASK_NAME,
  ),
  startGeofence: async (regions) => {
    await Location.startGeofencingAsync(
      SELECTED_PORT_GEOFENCE_TASK_NAME,
      regions.map((region) => ({
        identifier: selectedPortRegionIdentifier(region.portId),
        latitude: region.latitude,
        longitude: region.longitude,
        radius: region.radiusMeters,
        notifyOnEnter: true,
        notifyOnExit: true,
      })),
    );
  },
  stopGeofence: () => Location.stopGeofencingAsync(SELECTED_PORT_GEOFENCE_TASK_NAME),
  isHighAccuracyTrackingStarted: () => Location.hasStartedLocationUpdatesAsync(
    HIGH_ACCURACY_LOCATION_TASK_NAME,
  ),
  startHighAccuracyTracking: () => Location.startLocationUpdatesAsync(
    HIGH_ACCURACY_LOCATION_TASK_NAME,
    {
      accuracy: Location.Accuracy.High,
      distanceInterval: 5,
      timeInterval: 3_000,
      foregroundService: {
        notificationTitle: "Wayfarer navigation active",
        notificationBody: "Checking approach to your selected starport",
        notificationColor: "#BEF264",
        killServiceOnDestroy: true,
      },
    },
  ),
  stopHighAccuracyTracking: () => Location.stopLocationUpdatesAsync(
    HIGH_ACCURACY_LOCATION_TASK_NAME,
  ),
};

export const backgroundLocationController = createBackgroundLocationController(
  expoBackgroundLocationDriver,
);

export function emitBackgroundLocationSamples(samples: readonly LocationSample[]): void {
  for (const sample of samples) {
    for (const listener of sampleListeners) {
      try {
        listener(sample);
      } catch (error) {
        console.warn("Wayfarer background location listener failed", error);
      }
    }
  }
}

export function subscribeToBackgroundLocationSamples(
  listener: BackgroundLocationSampleListener,
): () => void {
  sampleListeners.add(listener);
  return () => { sampleListeners.delete(listener); };
}

export async function isCurrentSelectedPortRegion(identifier: string): Promise<boolean> {
  const options = await TaskManager.getTaskOptionsAsync<{
    regions?: Array<{ identifier?: string }>;
  }>(SELECTED_PORT_GEOFENCE_TASK_NAME);
  return options?.regions?.some((region) => region.identifier === identifier) === true;
}

export async function armSelectedPortGeofence(region: SelectedPortRegion): Promise<void> {
  await backgroundLocationController.armSelectedPort(region);
}

export async function disarmSelectedPortGeofence(): Promise<void> {
  await backgroundLocationController.disarmSelectedPort();
}

export const getBackgroundLocationStatus = backgroundLocationController.status;
export const requestBackgroundLocationPermissions = backgroundLocationController.requestPermissions;
export const startSelectedPortTracking = backgroundLocationController.startHighAccuracyTracking;
export const stopSelectedPortTracking = backgroundLocationController.stopHighAccuracyTracking;
