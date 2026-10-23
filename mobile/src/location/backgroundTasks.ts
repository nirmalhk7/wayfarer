import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import {
  isSelectedPortRegionIdentifier,
  locationSamplesFromExpoTaskData,
} from "./adapter.ts";
import { HIGH_ACCURACY_LOCATION_TASK_NAME, SELECTED_PORT_GEOFENCE_TASK_NAME } from "./constants.ts";
import {
  backgroundLocationController,
  emitBackgroundLocationSamples,
  isCurrentSelectedPortRegion,
} from "./runtime.ts";
import {
  pausePersistedDockingCoordinator,
  processPersistedBackgroundSamples,
} from "../ui/dockingSessionStore.ts";
import {
  pauseQualificationAfterLocationError,
  processHighAccuracyTaskData,
} from "./taskLifecycle.ts";

type GeofenceTaskData = {
  eventType?: Location.GeofencingEventType;
  region?: Location.LocationRegion;
};

if (!TaskManager.isTaskDefined(SELECTED_PORT_GEOFENCE_TASK_NAME)) {
  TaskManager.defineTask<GeofenceTaskData>(SELECTED_PORT_GEOFENCE_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.warn("Wayfarer selected-port geofence failed", error.message);
      return;
    }
    try {
      const identifier = data?.region?.identifier;
      if (!isSelectedPortRegionIdentifier(identifier)) return;

      const transition = data.eventType === Location.GeofencingEventType.Enter
        ? "enter"
        : data.eventType === Location.GeofencingEventType.Exit
          ? "exit"
          : null;
      if (!transition) return;

      await backgroundLocationController.handleGeofenceTransition(
        transition,
        () => isCurrentSelectedPortRegion(identifier),
        transition === "exit" ? async () => { await pausePersistedDockingCoordinator(); } : undefined,
      );
    } catch (taskError) {
      console.warn("Wayfarer selected-port geofence task failed", taskError);
    }
  });
}

if (!TaskManager.isTaskDefined(HIGH_ACCURACY_LOCATION_TASK_NAME)) {
  TaskManager.defineTask(HIGH_ACCURACY_LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.warn("Wayfarer high-accuracy location task failed", error.message);
      if (!await pauseQualificationAfterLocationError(pausePersistedDockingCoordinator)) {
        console.warn("Wayfarer could not persist the location-error pause");
      }
      return;
    }
    const result = await processHighAccuracyTaskData({
      decode: () => locationSamplesFromExpoTaskData(data),
      // Persist only the reduced docking coordinator; raw samples are never stored.
      persist: processPersistedBackgroundSamples,
      emit: emitBackgroundLocationSamples,
      pause: pausePersistedDockingCoordinator,
    });
    if (result.status === "failed") {
      console.warn(`Wayfarer high-accuracy location ${result.stage} failed`, result.error);
      if (result.stage !== "persist" && !result.pausePersisted) {
        console.warn("Wayfarer could not persist the task-failure pause");
      }
    }
  });
}
