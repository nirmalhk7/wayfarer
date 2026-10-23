import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("resolved Android config allows persisted geofence work after reboot", () => {
  const output = execFileSync(
    "npx",
    ["expo", "config", "--type", "public", "--json"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  const config = JSON.parse(output) as { android?: { permissions?: string[] } };

  assert.ok(config.android?.permissions?.includes("RECEIVE_BOOT_COMPLETED"));
  assert.ok(config.android?.permissions?.includes("POST_NOTIFICATIONS"));
});
