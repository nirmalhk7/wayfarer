import assert from "node:assert/strict";
import test from "node:test";

import {
  requestAndroidNotificationPermission,
  type AndroidNotificationPermissionDriver,
} from "../src/location/notificationPermission";

function driver(overrides: Partial<AndroidNotificationPermissionDriver> = {}): AndroidNotificationPermissionDriver {
  return {
    platform: "android",
    apiLevel: 35,
    checkPostNotifications: async () => false,
    requestPostNotifications: async () => "granted",
    ...overrides,
  };
}

test("requests POST_NOTIFICATIONS only on Android API 33 and later", async () => {
  let requests = 0;

  const result = await requestAndroidNotificationPermission(driver({
    requestPostNotifications: async () => {
      requests += 1;
      return "granted";
    },
  }));

  assert.equal(result, "granted");
  assert.equal(requests, 1);
});

test("does not prompt again when POST_NOTIFICATIONS is already granted", async () => {
  let requests = 0;

  const result = await requestAndroidNotificationPermission(driver({
    checkPostNotifications: async () => true,
    requestPostNotifications: async () => {
      requests += 1;
      return "granted";
    },
  }));

  assert.equal(result, "granted");
  assert.equal(requests, 0);
});

test("does not request POST_NOTIFICATIONS below Android 13", async () => {
  let requests = 0;

  const result = await requestAndroidNotificationPermission(driver({
    apiLevel: 32,
    requestPostNotifications: async () => {
      requests += 1;
      return "granted";
    },
  }));

  assert.equal(result, "not-required");
  assert.equal(requests, 0);
});

test("preserves a denied notification result without blocking the caller", async () => {
  const result = await requestAndroidNotificationPermission(driver({
    requestPostNotifications: async () => "denied",
  }));

  assert.equal(result, "denied");
});

test("does not request Android notification permission on another platform", async () => {
  let requests = 0;

  const result = await requestAndroidNotificationPermission(driver({
    platform: "ios",
    requestPostNotifications: async () => {
      requests += 1;
      return "granted";
    },
  }));

  assert.equal(result, "not-required");
  assert.equal(requests, 0);
});
