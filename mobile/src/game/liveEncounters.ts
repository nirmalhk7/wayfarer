import { encounterDraw, resolveEncounter, type Encounter, type GameState } from "./engine";

export type PortRanks = { crime: number; patrol: number };

export function liveEncounterOdds({ crime, patrol }: PortRanks) {
  const pirates = .15 + .023 * (crime - 5) - .006 * (patrol - 5);
  const customs = .135 + .025 * (patrol - 5);
  return { pirates, customs, none: 1 - pirates - customs };
}

export function rollLiveEncounter(seed: string, portId: string, ranks: PortRanks | undefined): Encounter | undefined {
  if (!ranks) return undefined;
  const odds = liveEncounterOdds(ranks);
  const key = `${seed}:${portId}:first-live-contact`;
  const draw = encounterDraw(key);
  const type = draw < odds.pirates ? "pirates" : draw < odds.pirates + odds.customs ? "customs" : undefined;
  return type ? { portId, type, severity: 1 + Math.floor(encounterDraw(key + ":severity") * 3) } : undefined;
}

export type LiveContactChoice = "evade" | "stop" | "surrender" | "fight";

export function resolveLiveContact(game: GameState, portId: string, choice: LiveContactChoice): GameState {
  const { pendingLiveEncounter: contact, ...cleared } = game;
  if (!contact || contact.portId !== portId) return game;
  if (choice === "evade" || choice === "fight") {
    return resolveEncounter({ ...cleared, encounter: contact }, choice === "evade" ? "run" : "fight");
  }
  const fee = choice === "surrender" ? 70 : contact.type === "pirates" ? 35 : 15;
  return {
    ...cleared,
    player: { ...cleared.player, credits: Math.max(0, cleared.player.credits - fee * contact.severity) },
  };
}
