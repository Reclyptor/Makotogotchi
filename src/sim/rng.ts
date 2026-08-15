// Seeded, keyed randomness (SPEC §4.4): every draw is a pure function of
// (generationSeed, tickIndex, purpose), so any two replays — on any JS
// engine — see the identical stream. All arithmetic is on uint32s via >>> 0
// and Math.imul, both exactly specified by ECMA-262.

export const RNG_PURPOSE = {
  sickOnset: 1,
} as const;

export type RngPurpose = (typeof RNG_PURPOSE)[keyof typeof RNG_PURPOSE];

/** murmur3's finalizer — full avalanche over a uint32. */
const avalanche = (value: number): number => {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
};

/**
 * Mix three keys with an avalanche between each absorption. Each input is
 * multiplied by a large odd constant before combining, so distinct
 * (seed, tick, purpose) triples can never alias each other the way a plain
 * sum would (seed+2 aliasing tick+2, etc.).
 */
const mix = (a: number, b: number, c: number): number => {
  let h = avalanche(0x9e3779b9 ^ Math.imul(a >>> 0, 0x93d765dd));
  h = avalanche(h ^ Math.imul(b >>> 0, 0xca01f9dd));
  h = avalanche(h ^ Math.imul(c >>> 0, 0x27d4eb2f));
  return h;
};

/** One mulberry32 step over the mixed key. Returns a uint32. */
export const draw32 = (generationSeed: number, tick: number, purpose: RngPurpose): number => {
  let t = (mix(generationSeed, tick, purpose) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
};
