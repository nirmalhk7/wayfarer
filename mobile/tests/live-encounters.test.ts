import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createAtlasLoader } from "../src/atlas/loader";
import { liveEncounterOdds, rollLiveEncounter } from "../src/game/liveEncounters";

test("Live odds respond independently, normalize and leave room for quiet visits", () => {
  for (let crime = 1; crime <= 10; crime++) {
    for (let patrol = 1; patrol <= 10; patrol++) {
      const odds = liveEncounterOdds({ crime, patrol });
      assert.ok(Object.values(odds).every((value) => value > 0 && value < 1));
      assert.ok(Math.abs(odds.pirates + odds.customs + odds.none - 1) < 1e-12);
      assert.ok(odds.none > .5);
      if (crime < 10) {
        const next = liveEncounterOdds({ crime: crime + 1, patrol });
        assert.ok(next.pirates > odds.pirates);
        assert.equal(next.customs, odds.customs);
      }
      if (patrol < 10) {
        const next = liveEncounterOdds({ crime, patrol: patrol + 1 });
        assert.ok(next.customs > odds.customs);
        assert.ok(next.pirates < odds.pirates);
      }
    }
  }
  for (let rank = 3; rank <= 6; rank++) {
    const odds = liveEncounterOdds({ crime: rank, patrol: rank });
    assert.ok(odds.pirates >= .1 && odds.customs >= .08 && odds.none >= .65);
  }
  const seed = "wayfarer-county-market-v1";
  assert.equal(rollLiveEncounter(seed, "county:06001", undefined), undefined);
  assert.equal(rollLiveEncounter(seed, "county:06001", { crime: 6, patrol: 6 })?.type, "pirates");
  assert.equal(rollLiveEncounter(seed, "county:06075", { crime: 6, patrol: 7 })?.type, "customs");
  assert.equal(rollLiveEncounter(seed, "county:06081", { crime: 5, patrol: 5 }), undefined);
});

const root = process.env.WAYFARER_ATLAS_TEST_DATA;
test("recognized county ranks come only from the pinned registry and survive an offline restart", { skip: !root }, async () => {
  const index = readFileSync(join(root!, "index.json"), "utf8");
  const counties = readFileSync(join(root!, "counties.json"), "utf8");
  const hash = async (data: string) => createHash("sha256").update(data).digest("hex");
  const cache = new Map<string, string>();
  let offline = false;
  let damaged = false;
  let registryRequests = 0;
  function loader(pin: string) {
    return createAtlasLoader({
      hash,
      read: async (key) => cache.get(key) ?? null,
      write: async (key, value) => { cache.set(key, value); },
      async get(path) {
        if (offline) throw new Error("offline");
        if (path === "index.json") return index;
        assert.equal(path, "counties.json");
        registryRequests++;
        return damaged ? counties + " " : counties;
      },
    }, pin);
  }
  const pin = await hash(index);
  damaged = true;
  assert.equal(await loader(pin).ranksFor("county:06081"), undefined);
  damaged = false;
  const online = loader(pin);
  const two = await Promise.all([online.ranksFor("county:06081"), online.ranksFor("county:06075")]);
  assert.deepEqual(two, [{ crime: 5, patrol: 5 }, { crime: 6, patrol: 6 }]);
  assert.equal(registryRequests, 2);
  offline = true;
  assert.deepEqual(await loader(pin).ranksFor("county:06081"), two[0]);
  assert.equal(await loader(pin).ranksFor("county:00000"), undefined);
  assert.equal(registryRequests, 2);
});
