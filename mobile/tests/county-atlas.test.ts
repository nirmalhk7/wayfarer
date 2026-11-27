import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { compassRange } from "../src/game/compass";
import { createCountyCampaign, recordCountyVisit } from "../src/game/countyCampaign";
import { nearbyPorts, decodeTile, resolvePort, tileKey } from "../src/atlas/geometry";
import { decodeGameState, encodeGameState } from "../src/persistence";
import { atlasFixture } from "./atlas-fixture";

test("cached verified port data reopens offline and uncached regions grant no access", async () => {
  const data = atlasFixture();
  const point = { latitude: 37.5585, longitude: -122.2711 };
  const key = tileKey(point);
  const [first, parallel] = await Promise.all([data.atlas.load(key), data.atlas.load(key)]);
  assert.ok(first);
  assert.equal(first, parallel);
  assert.deepEqual(data.paths, ["index.json", "tiles/-123_37.json"]);
  data.offline(true);
  data.restart();
  assert.deepEqual(await data.atlas.load(key), first);
  assert.deepEqual(resolvePort(first, point, 40), { kind: "inside", port: { id: "county:06081", name: "San Mateo" } });
  assert.equal(data.paths.length, 2);
  await assert.rejects(() => data.atlas.load("-125_40"));
  assert.equal(data.atlas.peek("-125_40"), undefined);
  assert.equal(await data.atlas.load("0_0"), null);
});

test("the same county yields one reusable market without storing measured coordinates", () => {
  const base = createCountyCampaign();
  const county = { id: "county:06081", name: "San Mateo" };
  const next = recordCountyVisit(base, county);
  assert.equal(recordCountyVisit(next, county), next);
  assert.equal(decodeGameState(encodeGameState(next), "training"), null);
  assert.deepEqual(decodeGameState(encodeGameState(next), "county-live"), next);
  assert.throws(() => encodeGameState({ ...next, dockedPortId: county.id }));
});

const root = process.env.WAYFARER_ATLAS_TEST_DATA;
test("official 2026 pack resolves county, state, tile and date line transitions", { skip: !root }, () => {
  function at(latitude: number, longitude: number) {
    const point = { latitude, longitude };
    const key = tileKey(point);
    const tile = decodeTile(gunzipSync(readFileSync(join(root!, "tiles", key + ".json.gz"))).toString(), key);
    return { point, tile, result: resolvePort(tile, point, 40) };
  }
  const rows = [
    [37.5585, -122.2711, "county:06081"], // Foster City
    [37.5841, -122.3661, "county:06081"], // Burlingame
    [37.5985, -122.3871, "county:06081"], // Millbrae
    [37.7599, -122.4384, "county:06075"], // San Francisco
    [45.64, -122.60, "county:53011"], // Clark, WA
    [45.53, -122.67, "county:41051"], // Multnomah, OR
    [51.95, 179.77, "county:02016"],
    [51.249, -179.225, "county:02016"],
    [21.3069, -157.8583, "county:15003"],
    [38.9072, -77.0369, "county:11001"],
  ] as const;
  for (const [lat, lon, id] of rows) {
    const { result } = at(lat, lon);
    assert.equal(result.kind === "inside" && result.port.id, id);
  }
  assert.equal(tileKey({ latitude: 51.7, longitude: 180 }), "-180_51");
  assert.equal(at(37.708333, -122.45).result.kind, "border");
  const local = at(37.7599, -122.4384);
  const neighbor = nearbyPorts(local.tile, local.point, "county:06075").find(({ id }) => id === "county:06081");
  assert.ok(neighbor?.direction);
  assert.equal(compassRange(neighbor.direction), "5.7 km · South 182° true");
});

test("holes remain outside and synthetic clipping edges never provide a bearing", () => {
  const entire: [number, number][] = [[-.25,-.25], [1.25,-.25], [1.25,1.25], [-.25,1.25], [-.25,-.25]];
  const hole: [number, number][] = [[.35,.35], [.65,.35], [.65,.65], [.35,.65], [.35,.35]];
  const limits: [number, number, number, number] = [-.25,-.25,1.25,1.25];
  const port = { id: "county:01001", name: "Sample" };
  const tile = { limits, ports: [{ port, limits, polygons: [[entire, hole]] }] };
  const center = { latitude: .5, longitude: .5 };
  assert.equal(resolvePort(tile, center, 40).kind, "outside");
  assert.equal(resolvePort(tile, { latitude: .5, longitude: .35 }, 40).kind, "border");
  const noTrueEdges = { limits, ports: [{ port, limits, polygons: [[entire]] }] };
  assert.deepEqual(nearbyPorts(noTrueEdges, center), []);
});
