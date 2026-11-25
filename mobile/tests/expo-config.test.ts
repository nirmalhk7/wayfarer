import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { HIGH_ACCURACY_LOCATION_TASK_NAME } from "../src/location/constants.ts";

test("resolved Android config allows persisted geofence work after reboot", () => {
  const output = execFileSync(
    "npx",
    ["expo", "config", "--type", "public", "--json"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  const config = JSON.parse(output) as {
    android?: { allowBackup?: boolean; permissions?: string[] };
  };

  assert.equal(config.android?.allowBackup, false);
  assert.ok(config.android?.permissions?.includes("RECEIVE_BOOT_COMPLETED"));
  assert.ok(config.android?.permissions?.includes("POST_NOTIFICATIONS"));
});

test("Android task scheduling keeps raw location jobs out of persistent storage", () => {
  const output = execFileSync(
    "npx",
    ["expo-modules-autolinking", "resolve", "--platform", "android", "--json"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  const config = JSON.parse(output) as {
    configuration?: { buildFromSource?: string[] };
    modules: { packageName: string; projects: { name: string }[] }[];
  };
  const taskManagerProject = config.modules
    .find((module) => module.packageName === "expo-task-manager")?.projects[0];
  assert.ok(taskManagerProject);
  assert.ok(config.configuration?.buildFromSource?.includes(taskManagerProject.name));
  assert.ok(config.configuration?.buildFromSource?.includes("unimodules-app-loader"));

  const taskManager = new URL(
    "../node_modules/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskManagerUtils.java",
    import.meta.url,
  );
  const source = readFileSync(taskManager, "utf8");
  assert.ok(source.includes(
    `.setPersisted(!"${HIGH_ACCURACY_LOCATION_TASK_NAME}".equals(extras.getString("taskName")))`,
  ));
});
