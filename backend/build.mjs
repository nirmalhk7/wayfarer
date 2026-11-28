import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = fileURLToPath(new URL(".", import.meta.url));
const ranks = await readFile(new URL("../tools/county2026-game-ranks.tsv", import.meta.url), "utf8");

await build({
  absWorkingDir: directory,
  entryPoints: ["trading-http.mjs"],
  outfile: ".generated/trading-http.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  tsconfigRaw: {},
  format: "esm",
  plugins: [{
    name: "embed-county-ranks",
    setup(builder) {
      builder.onLoad({ filter: /[/\\]rank-source\.mjs$/ }, () => ({
        contents: "export const rankSource = " + JSON.stringify(ranks) + ";",
        loader: "js",
      }));
    },
  }],
});
