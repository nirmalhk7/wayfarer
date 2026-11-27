import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("resolved Android config uses foreground permission with plain port language", () => {
  const output = execFileSync(
    "npx",
    ["expo", "config", "--type", "public", "--json"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  const config = JSON.parse(output) as {
    platforms?: string[];
    android?: { permissions?: string[]; blockedPermissions?: string[] };
    plugins?: (string | [string, { locationWhenInUsePermission?: string }])[];
  };

  assert.deepEqual(config.platforms, ["android"]);
  assert.ok(config.android?.permissions?.includes("ACCESS_FINE_LOCATION"));
  assert.ok(config.android?.blockedPermissions?.includes("android.permission.ACCESS_BACKGROUND_LOCATION"));
  assert.ok(!config.android?.permissions?.includes("ACCESS_BACKGROUND_LOCATION"));
  const location = config.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-location");
  assert.ok(Array.isArray(location));
  const wording = location[1].locationWhenInUsePermission;
  assert.ok(wording);
  assert.match(wording, /on this device to find your port, show nearby ranges, and open the local market/);
  assert.doesNotMatch(wording, /census|tiger|subdivision|geoid|\bCCD\b|county/iu);
});
