import { createGame, type GameState } from "./engine";
import { PILOT_PORTS, SUBDIVISION_MAP_ID } from "../territories/subdivisions";

export function createSubdivisionCampaign(legacy?: GameState): GameState {
  const ports = PILOT_PORTS.map(({ geoid, name, referencePoint: [longitude, latitude] }) => {
    const position = { longitude, latitude };
    const { market } = createGame({ origin: position, seed: "cousub:" + geoid }).ports[1];
    return { id: geoid, name, callsign: geoid, position, market };
  });
  const base = createGame({ origin: ports[0].position, seed: "wayfarer-cousub-v1" });
  return {
    ...base,
    mapId: SUBDIVISION_MAP_ID,
    ports,
    dockedPortId: null,
    revealedMarketIds: [],
    discoveredPortIds: [],
    player: legacy?.player ?? base.player,
  };
}

export function recordSubdivisionVisit(game: GameState, geoid: string | null): GameState {
  if (!geoid || game.discoveredPortIds.includes(geoid) || !game.ports.some((port) => port.id === geoid)) return game;
  return {
    ...game,
    discoveredPortIds: [...game.discoveredPortIds, geoid],
    revealedMarketIds: [...game.revealedMarketIds, geoid],
  };
}
