import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { HIGH_ACCURACY_LOCATION_TASK_NAME, SELECTED_PORT_GEOFENCE_TASK_NAME } from "./constants";

export async function stopLegacyPointTasks() {
  if (!await TaskManager.isAvailableAsync()) return;
  const [watching, geofencing] = await Promise.all([
    Location.hasStartedLocationUpdatesAsync(HIGH_ACCURACY_LOCATION_TASK_NAME),
    Location.hasStartedGeofencingAsync(SELECTED_PORT_GEOFENCE_TASK_NAME),
  ]);
  await Promise.all([
    watching && Location.stopLocationUpdatesAsync(HIGH_ACCURACY_LOCATION_TASK_NAME),
    geofencing && Location.stopGeofencingAsync(SELECTED_PORT_GEOFENCE_TASK_NAME),
  ]);
}

// Existing installs can still receive a legacy headless event until Android unregisters it.
for (const name of [HIGH_ACCURACY_LOCATION_TASK_NAME, SELECTED_PORT_GEOFENCE_TASK_NAME]) {
  if (!TaskManager.isTaskDefined(name)) {
    TaskManager.defineTask(name, async () => { await stopLegacyPointTasks().catch(() => {}); });
  }
}
