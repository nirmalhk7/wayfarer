import { readFileSync } from "node:fs";

export const rankSource = readFileSync(new URL("../tools/county2026-game-ranks.tsv", import.meta.url), "utf8");
