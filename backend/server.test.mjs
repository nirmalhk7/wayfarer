import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("local backend entry point serves the Android catalog and has no web or write routes", async (t) => {
  const script = fileURLToPath(new URL("./server.mjs", import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), "wayfarer-atlas-"));
  const real = process.env.WAYFARER_ATLAS_TEST_DATA;
  const release = real ?? join(temporary, "county2026-v1");
  const key = "-123_37";
  if (!real) {
    await mkdir(join(release, "tiles"), { recursive: true });
    await writeFile(join(release, "index.json"), '{"revision":"county2026-v1"}\n');
    await writeFile(join(release, "tiles", key + ".json.gz"), gzipSync('{"tile":"-123_37"}\n'));
  }
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: "0", WAYFARER_ATLAS_DIR: dirname(release) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const closed = once(child, "close");
  t.after(async () => { child.kill(); await closed; });
  const endpoint = await Promise.race([
    once(child.stdout, "data").then(([chunk]) => {
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk));
      assert.ok(match, "server must report its loopback port");
      return match[0];
    }),
    closed.then(([code]) => { throw new Error("Server closed before startup: " + code); }),
  ]);

  const health = await fetch(endpoint + "/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const atlas = await fetch(endpoint + "/v1/territories");
  assert.equal(atlas.status, 200);
  assert.equal(atlas.headers.get("content-type"), "application/geo+json");
  const shipped = await readFile(new URL("../mobile/src/territories/north-coast.json", import.meta.url), "utf8");
  assert.equal(await atlas.text(), shipped);
  const data = JSON.parse(shipped);
  assert.equal(data.revision, "north-coast-2025-cb500k.v1");
  assert.deepEqual(data.features.map((county) => county.id), ["06015", "06023"]);

  assert.equal((await fetch(endpoint + "/v2/ports")).status, 410);
  assert.equal((await fetch(endpoint + "/v2/ports/0602390100/boundary")).status, 410);
  const base = endpoint + "/atlas/" + basename(release);
  const index = await fetch(base + "/index.json");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("cache-control"), /immutable/);
  assert.equal(await index.text(), await readFile(join(release, "index.json"), "utf8"));
  if (real) {
    const registry = await fetch(base + "/counties.json");
    assert.equal(registry.status, 200);
    const { ports } = await registry.json();
    assert.equal(ports.length, 3144);
    assert.equal(new Set(ports.map(({ geoid }) => geoid)).size, 3144);
    assert.equal(new Set(ports.map(({ stateGeoid }) => stateGeoid)).size, 51);
  }
  const tile = await fetch(base + "/tiles/" + key + ".json");
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get("content-encoding"), "gzip");
  const expected = gunzipSync(await readFile(join(release, "tiles", key + ".json.gz"))).toString();
  assert.equal(await tile.text(), expected);
  const plain = await fetch(base + "/tiles/" + key + ".json", { headers: { "Accept-Encoding": "identity" } });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(await plain.text(), expected);
  assert.equal((await fetch(base + "/tiles/0_0.json")).status, 404);
  assert.equal((await fetch(base + "/index.json?extra=1")).status, 400);

  const head = await fetch(endpoint + "/v1/territories", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(Number(head.headers.get("content-length")), Buffer.byteLength(shipped));
  const write = await fetch(endpoint + "/v1/territories", { method: "POST", body: "{}" });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("allow"), "GET, HEAD");
  assert.equal((await fetch(endpoint + "/v1/territories?unexpected=1")).status, 400);
  assert.equal((await fetch(endpoint + "/")).status, 404);
});
