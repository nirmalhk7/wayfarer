import { ATLAS_REVISION, decodeTile, MAX_TILE_BYTES, PORT_ID, TILE_ID, type AtlasTile } from "./geometry";

import type { PortRanks } from "../game/liveEncounters";

type Entry = { bytes: number; sha256: string };
type Index = { countiesSha256?: string; tiles: Record<string, Entry> };
type Source = {
  get: (path: string) => Promise<string>;
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  hash: (value: string) => Promise<string>;
};

const hashPattern = /^[a-f0-9]{64}$/;

function parseIndex(raw: string): Index {
  if (raw.length > 1_000_000) throw new Error("Port index is too large");
  const index = JSON.parse(raw);
  if (!index || index.revision !== ATLAS_REVISION || index.halo !== .25 || index.scale !== 10_000_000
    || typeof index.tiles !== "object" || !index.tiles || Array.isArray(index.tiles)) {
    throw new Error("Invalid port index");
  }
  if (index.countiesSha256 !== undefined && (index.release !== "county2026-v2"
    || typeof index.countiesSha256 !== "string" || !hashPattern.test(index.countiesSha256))) {
    throw new Error("Invalid ranked port registry reference");
  }
  for (const [key, entry] of Object.entries<Entry>(index.tiles)) {
    if (!TILE_ID.test(key) || !entry || !hashPattern.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_TILE_BYTES) {
      throw new Error("Invalid region in port index");
    }
  }
  return index;
}

export function createAtlasLoader(source: Source, expectedIndexHash: string) {
  let manifest: Promise<Index> | undefined;
  let rankedPorts: Promise<Map<string, PortRanks>> | undefined;
  let recent: { key: string; tile: AtlasTile | null } | undefined;
  const pending = new Map<string, Promise<AtlasTile | null>>();
  const prefix = ATLAS_REVISION + "-" + expectedIndexHash;

  async function readVerified(key: string, path: string, hash: string, max: number) {
    const verify = async (raw: string) => raw.length <= max && await source.hash(raw) === hash;
    const cached = await source.read(key).catch(() => null);
    if (cached && await verify(cached)) return cached;
    const raw = await source.get(path);
    if (!await verify(raw)) throw new Error("Port data failed its integrity check");
    await source.write(key, raw).catch(() => {});
    return raw;
  }

  function index() {
    manifest ??= readVerified(prefix + "-index.json", "index.json", expectedIndexHash, 1_000_000)
      .then(parseIndex).catch((error) => { manifest = undefined; throw error; });
    return manifest;
  }

  async function ranksFor(portId: string): Promise<PortRanks | undefined> {
    if (!PORT_ID.test(portId) || !hashPattern.test(expectedIndexHash)) return undefined;
    try {
      const { countiesSha256 } = await index();
      if (!countiesSha256) return undefined;
      rankedPorts ??= readVerified(prefix + "-counties.json", "counties.json", countiesSha256, 1_000_000)
        .then((raw) => {
          const registry = JSON.parse(raw);
          if (registry?.revision !== "county2026-v2" || !Array.isArray(registry.ports) || registry.ports.length !== 3144) {
            throw new Error("Invalid ranked port registry");
          }
          const ports = new Map<string, PortRanks>();
          const valid = (rank: unknown): rank is number =>
            typeof rank === "number" && Number.isInteger(rank) && rank >= 1 && rank <= 10;
          for (const entry of registry.ports) {
            if (!entry || typeof entry.geoid !== "string" || typeof entry.id !== "string"
              || entry.id !== "county:" + entry.geoid || !PORT_ID.test(entry.id) || ports.has(entry.id)
              || !valid(entry.crime_rank) || !valid(entry.patrol_rank)) throw new Error("Invalid port ranks");
            ports.set(entry.id, { crime: entry.crime_rank, patrol: entry.patrol_rank });
          }
          return ports;
        }).catch((error) => { rankedPorts = undefined; throw error; });
      return (await rankedPorts).get(portId);
    } catch {
      // An offline legacy or unavailable registry cannot fabricate ranks.
      return undefined;
    }
  }

  async function load(key: string) {
    if (!TILE_ID.test(key) || !hashPattern.test(expectedIndexHash)) throw new Error("Port downloads are unavailable");
    if (recent?.key === key) return recent.tile;
    const ongoing = pending.get(key);
    if (ongoing) return ongoing;
    const request = (async () => {
      const entry = (await index()).tiles[key];
      const tile = entry ? decodeTile(await readVerified(
        prefix + "-" + key + ".json", "tiles/" + key + ".json", entry.sha256, entry.bytes,
      ), key) : null;
      recent = { key, tile };
      return tile;
    })();
    pending.set(key, request);
    try { return await request; }
    finally { pending.delete(key); }
  }

  return { load, ranksFor, peek: (key: string) => recent?.key === key ? recent.tile : undefined };
}
