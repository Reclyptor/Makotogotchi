// Dynamic difficulty (SPEC §23): the pet's need decay scales with the size
// of the community actually caring for it.
//
// The balance without this is fixed: one caretaker may restore four days of
// decay per need per rolling week (§2.5) against a pet that spends seven, so
// two committed people sit just above water. Ten people supply forty days
// against the same seven and the pet never leaves 100% — the stakes, and with
// them the point, disappear. Demand therefore follows supply.

/** The community size the original balance was tuned for. */
export const DIFFICULTY_BASELINE = 2;
/** How far the multiplier must move before the leader records it (§23.2). */
export const DIFFICULTY_STEP_PERMILLE = 100;

/**
 * Multiplier per active caretaker count, in per-mille, following
 * `clamp((max(P, 2) / 2) ^ 0.75, 1, 3)`.
 *
 * It is a table rather than a call to `Math.pow` on purpose: ECMA-262 leaves
 * `Math.pow` implementation-approximated, and a one-ULP disagreement between
 * two engines replaying the same log is precisely the drift §4.4 forbids.
 * These integers are the same on every machine, forever.
 */
const MULTIPLIER_PERMILLE: readonly number[] = [
  1000, // 0 caretakers — the floor; a quiet week is never easier than baseline
  1000, // 1
  1000, // 2 — the tuned baseline
  1355, // 3
  1682, // 4
  1988, // 5
  2280, // 6
  2559, // 7
  2828, // 8
  3000, // 9 and beyond — the ceiling
];

/** The decay multiplier for a population, in per-mille (1000 = 1.00×). */
export const careMultiplierPermille = (population: number | undefined): number => {
  if (population === undefined || !Number.isFinite(population)) return 1000;
  const count = Math.max(0, Math.floor(population));
  return MULTIPLIER_PERMILLE[Math.min(count, MULTIPLIER_PERMILLE.length - 1)]!;
};

/** The same multiplier as a number, for display (SPEC §23.3). */
export const careMultiplier = (population: number | undefined): number => careMultiplierPermille(population) / 1000;

/** Whether a newly measured population is worth recording as an event. */
export const worthRecording = (recorded: number | undefined, measured: number): boolean =>
  Math.abs(careMultiplierPermille(measured) - careMultiplierPermille(recorded)) >= DIFFICULTY_STEP_PERMILLE;
