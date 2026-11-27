import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("resolved Android config uses foreground permission for subdivision arrivals", () => {
  const output = execFileSync(
    "npx",
    ["expo", "config", "--type", "public", "--json"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  const config = JSON.parse(output) as { platforms?: string[]; android?: { permissions?: string[]; blockedPermissions?: string[] } };

  assert.deepEqual(config.platforms, ["android"]);
  assert.ok(config.android?.permissions?.includes("ACCESS_FINE_LOCATION"));
  assert.ok(config.android?.blockedPermissions?.includes("android.permission.ACCESS_BACKGROUND_LOCATION"));
  assert.ok(!config.android?.permissions?.includes("ACCESS_BACKGROUND_LOCATION"));
});
