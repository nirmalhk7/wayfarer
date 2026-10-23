export type NotificationPermissionResult = "granted" | "denied" | "not-required";

export type AndroidNotificationPermissionDriver = {
  platform: string;
  apiLevel: number;
  checkPostNotifications: () => Promise<boolean>;
  requestPostNotifications: () => Promise<string>;
};

/**
 * Android 13 introduced POST_NOTIFICATIONS as a runtime permission. A denied
 * result must not prevent location qualification; Android still permits the
 * foreground location service, while exposing its status outside the drawer.
 */
export async function requestAndroidNotificationPermission(
  driver: AndroidNotificationPermissionDriver,
): Promise<NotificationPermissionResult> {
  if (driver.platform !== "android" || driver.apiLevel < 33) return "not-required";

  try {
    if (await driver.checkPostNotifications()) return "granted";
    return await driver.requestPostNotifications() === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}
