import { createGame, type GameState, type Starport } from "./engine";
import type { AtlasPort } from "../atlas/geometry";

export const COUNTY_CAMPAIGN_ID = "county-live-v1";
export const COUNTY_GAME_SEED = "wayfarer-county-market-v1";
export const COUNTY_GAME_ORIGIN = { latitude: 0, longitude: 0 };

export function createCountyCampaign(previous?: GameState): GameState {
  const base = createGame({ origin: COUNTY_GAME_ORIGIN, seed: COUNTY_GAME_SEED });
  return {
    ...base,
    mapId: COUNTY_CAMPAIGN_ID,
    ports: [],
    dockedPortId: null,
    revealedMarketIds: [],
    discoveredPortIds: [],
    player: previous?.player ?? base.player,
  };
}

export function createCountyPort({ id, name }: AtlasPort): Starport {
  const { market } = createGame({ origin: COUNTY_GAME_ORIGIN, seed: id }).ports[1];
  // GameState's shared shape uses position for Training. Live navigation and
  // compass measurements always use the downloaded boundary, never this sentinel.
  return { id, name, callsign: id, position: { ...COUNTY_GAME_ORIGIN }, market };
}

export function recordCountyVisit(game: GameState, port: AtlasPort): GameState {
  const previous = game.ports.find(({ id }) => id === port.id);
  if (previous?.name === port.name) return game;
  if (previous) return {
    ...game,
    ports: game.ports.map((item) => item.id === port.id ? { ...item, name: port.name } : item),
  };
  return {
    ...game,
    ports: [...game.ports, createCountyPort(port)],
    discoveredPortIds: [...game.discoveredPortIds, port.id],
    revealedMarketIds: [...game.revealedMarketIds, port.id],
  };
}
