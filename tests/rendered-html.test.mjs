import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Wayfarer trading console", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Wayfarer[^<]*<\/title>/i);
  assert.match(html, /WAYFARER/i);
  assert.match(html, /Galactic News/i);
  assert.match(html, /Local Star Chart/i);
  assert.match(html, /Ship Manifest/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("removes starter-only assets and metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /GameShell/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /Wayfarer/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("../app/_sites-preview", import.meta.url)),
  );
  await assert.rejects(
    access(new URL("public/_sites-preview", templateRoot)),
  );
});

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? filesUnder(url) : [url];
  }));
  return nested.flat();
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("No JPEG dimensions found");
}

test("keeps the sole-route payload and social preview within performance budgets", async () => {
  const staticFiles = await filesUnder(new URL("../dist/client/_next/static/", import.meta.url));
  const javascript = await Promise.all(
    staticFiles.filter((url) => url.pathname.endsWith(".js")).map((url) => readFile(url)),
  );
  const css = await Promise.all(
    staticFiles.filter((url) => url.pathname.endsWith(".css")).map((url) => readFile(url)),
  );
  const javascriptGzipBytes = javascript.reduce((total, bytes) => total + gzipSync(bytes).byteLength, 0);
  const cssGzipBytes = css.reduce((total, bytes) => total + gzipSync(bytes).byteLength, 0);
  assert.ok(javascriptGzipBytes <= 200 * 1024, `initial JS is ${javascriptGzipBytes} gzip bytes`);
  assert.ok(cssGzipBytes <= 50 * 1024, `initial CSS is ${cssGzipBytes} gzip bytes`);

  const ogUrl = new URL("../public/og.jpg", import.meta.url);
  await assert.doesNotReject(access(ogUrl), "optimized Open Graph JPEG must exist");
  const [layout, ogBytes, ogStat] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(ogUrl),
    stat(ogUrl),
  ]);
  assert.ok(ogStat.size <= 300 * 1024, `Open Graph image is ${ogStat.size} bytes`);
  assert.deepEqual(jpegDimensions(ogBytes), { width: 1200, height: 630 });
  assert.match(layout, /images: \[\{ url: "\/og\.jpg", width: 1200, height: 630 \}\]/);
  assert.match(layout, /images: \["\/og\.jpg"\]/);

  for (const asset of ["og.png", "file.svg", "globe.svg", "window.svg"]) {
    await assert.rejects(access(new URL(`../public/${asset}`, import.meta.url)));
  }
});
