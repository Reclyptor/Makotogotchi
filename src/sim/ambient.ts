// Shared rare events (SPEC §21.5): roughly once an hour something small and
// delightful happens, and it happens for everyone at the same moment — which
// is the entire point. The draw is keyed to the absolute tick, so the leader
// that observes it records a milestone and every client hears about the same
// instant rather than each rolling its own private wonder.
//
// Nothing here touches the economy. The moment is the reward.

import { draw32, RNG_PURPOSE } from "./rng";

export const AMBIENT_EVENTS = ["shooting-star", "butterfly", "coin-dig", "mystery-noise"] as const;
export type AmbientEvent = (typeof AMBIENT_EVENTS)[number];

/** Ticks are 10s, so one chance in 360 averages one moment per hour. */
export const AMBIENT_ODDS_P32 = Math.floor(2 ** 32 / 360);

type Candidate = { event: AmbientEvent; weight: number; whileAwake: boolean; whileAsleep: boolean };

const TABLE: readonly Candidate[] = [
  { event: "shooting-star", weight: 3, whileAwake: false, whileAsleep: true },
  { event: "butterfly", weight: 3, whileAwake: true, whileAsleep: false },
  { event: "coin-dig", weight: 2, whileAwake: true, whileAsleep: false },
  { event: "mystery-noise", weight: 1, whileAwake: true, whileAsleep: true },
];

export const isAmbientEvent = (value: unknown): value is AmbientEvent =>
  typeof value === "string" && (AMBIENT_EVENTS as readonly string[]).includes(value);

/** The moment this tick brings, if any. */
export const ambientAt = (seed: number, tick: number, asleep: boolean): AmbientEvent | null => {
  if (draw32(seed, tick, RNG_PURPOSE.ambientOdds) >= AMBIENT_ODDS_P32) return null;

  const eligible = TABLE.filter((candidate) => (asleep ? candidate.whileAsleep : candidate.whileAwake));
  const total = eligible.reduce((sum, candidate) => sum + candidate.weight, 0);
  let remaining = draw32(seed, tick, RNG_PURPOSE.ambientPick) % total;
  // The walk always lands inside the table; the last entry is the tail case.
  let chosen = eligible[eligible.length - 1]!;
  for (const candidate of eligible) {
    if (remaining < candidate.weight) {
      chosen = candidate;
      break;
    }
    remaining -= candidate.weight;
  }
  return chosen.event;
};
