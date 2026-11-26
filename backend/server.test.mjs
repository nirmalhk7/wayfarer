import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("local backend entry point serves the Android catalog and has no web or write routes", async (t) => {
  const script = fileURLToPath(new URL("./server.mjs", import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: "0" },
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
