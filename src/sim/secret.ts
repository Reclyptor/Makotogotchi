// The ancient code's spectacle (SPEC §26). Which of the two moods the room
// puts on is decided here, from the pet's own state — and decided once, by
// the server, rather than by each client against its own projection. Two
// clients straddling the wake tick would otherwise disagree, and half a room
// on confetti while the other half is under a meteor shower quietly undoes
// the only thing this feature is for.
//
// Nothing here touches the economy. The moment is the reward (SPEC §21.5).

import type { PetState } from "./model";

export const SPECTACLE_MOODS = ["party", "stars"] as const;
export type SpectacleMood = (typeof SPECTACLE_MOODS)[number];

export const isSpectacleMood = (value: unknown): value is SpectacleMood =>
  typeof value === "string" && (SPECTACLE_MOODS as readonly string[]).includes(value);

/**
 * The mood the room owes this moment (SPEC §26.3).
 *
 * Death takes the stars whatever the hour: the memorial is not a place for
 * confetti, and giving it the version of the effect that suits it is better
 * than carving out an exception that makes the code look broken there. An
 * egg is hopeful — incubation parties.
 */
export const spectacleMood = (state: PetState): SpectacleMood => {
  if (state.diedAtTick !== null) return "stars";
  if (state.bornAtTick === null) return "party";
  return state.asleep ? "stars" : "party";
};
