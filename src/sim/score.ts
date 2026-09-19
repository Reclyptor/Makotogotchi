// Contribution scoring and the per-caretaker rolling restoration budget
// (SPEC §2.5, §2.11). The budget rings live inside PetState and fold from
// events like everything else; the mutating helpers here work on a draft that
// reduce() owns and are never handed an input state directly. The read-only
// ones at the foot of the file are the exception, and deliberately so: the
// budget is half of what a caretaker needs to know before pressing anything
// (SPEC §23 is the other half), and the UI reads it from here rather than
// keeping a second copy of the arithmetic.

import type { BudgetDay, CaretakerRecord, PetState } from "./model";
import {
  BUDGET_WINDOW_DAYS,
  CONTRIBUTION_WEIGHTS,
  diminishedMagnitude,
  MAGNITUDE_ACTIONS,
  NEED_KEYS,
  SCORE_DIVISOR,
  TICKS_PER_DAY,
  weeklyBudget,
  type CareAction,
  type NeedKey,
} from "./tuning";
import { careMultiplierPermille, presencePermilleOf } from "./difficulty";

export const petDay = (tick: number): number => Math.floor(tick / TICKS_PER_DAY);

/** Where a caretaker's record sits, or would sit — sorted by id, which is the
 *  canonical order replay determinism depends on. */
const locate = (state: PetState, caretakerId: string): number => {
  let low = 0;
  let high = state.caretakers.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (state.caretakers[mid]!.id < caretakerId) low = mid + 1;
    else high = mid;
  }
  return low;
};

/** Find or insert. */
export const caretakerRecord = (draft: PetState, caretakerId: string): CaretakerRecord => {
  const at = locate(draft, caretakerId);
  const found = draft.caretakers[at];
  if (found && found.id === caretakerId) return found;
  const record: CaretakerRecord = { id: caretakerId, lastActionTick: {}, budget: {} };
  draft.caretakers.splice(at, 0, record);
  return record;
};

/** Read-only lookup: a caretaker who has never acted simply has no record. */
export const findCaretaker = (state: PetState, caretakerId: string): CaretakerRecord | null => {
  const found = state.caretakers[locate(state, caretakerId)];
  return found && found.id === caretakerId ? found : null;
};

const pruneRing = (ring: BudgetDay[], day: number): void => {
  const oldest = day - (BUDGET_WINDOW_DAYS - 1);
  while (ring.length > 0 && ring[0]!.day < oldest) ring.shift();
};

/**
 * How much applied restoration this caretaker has left for a need right now,
 * at `multiplierPermille` — the community's difficulty, because the allowance
 * is scaled by exactly what the demand it covers is scaled by (SPEC §2.5).
 */
export const budgetRemaining = (
  record: CaretakerRecord,
  need: NeedKey,
  tick: number,
  multiplierPermille = 1000,
): number => {
  const day = petDay(tick);
  const oldest = day - (BUDGET_WINDOW_DAYS - 1);
  let spent = 0;
  for (const entry of record.budget[need] ?? []) {
    if (entry.day >= oldest) spent += entry.applied;
  }
  const remaining = weeklyBudget(need, multiplierPermille) - spent;
  return remaining > 0 ? remaining : 0;
};

export const recordApplied = (record: CaretakerRecord, need: NeedKey, tick: number, applied: number): void => {
  if (applied <= 0) return;
  const day = petDay(tick);
  const ring = (record.budget[need] ??= []);
  pruneRing(ring, day);
  const last = ring[ring.length - 1];
  if (last && last.day === day) last.applied += applied;
  else ring.push({ day, applied });
};

/** Drop caretakers with no activity inside the budget window — stale ghosts. */
export const pruneCaretakers = (draft: PetState, tick: number): void => {
  const horizon = tick - BUDGET_WINDOW_DAYS * TICKS_PER_DAY;
  draft.caretakers = draft.caretakers.filter((record) => {
    const lastTicks = Object.values(record.lastActionTick);
    const lastActive = lastTicks.length > 0 ? Math.max(...lastTicks) : -Infinity;
    return lastActive >= horizon;
  });
};

/** Leaderboard points for one performed action (SPEC §2.11). */
export const contributionScore = (action: CareAction, applied: number): number => {
  const weight = CONTRIBUTION_WEIGHTS[action];
  if ("flat" in weight) return weight.flat;
  return Math.floor((applied * weight.perApplied) / SCORE_DIVISOR);
};

// ── What a caretaker can still do, read-only (SPEC §2.5, §11.2) ─────────────

/**
 * How much of each need's weekly allowance this caretaker has left, as whole
 * percentages. A caretaker with no record yet has spent nothing.
 *
 * The meters say how much care the pet demands; without this they never said
 * how much any one person is still able to supply, and a spent allowance was
 * indistinguishable from a bug. It is derived, never stored — `budgetRemaining`
 * is the single source, and this only puts a percentage on it.
 */
export const allowanceRemaining = (state: PetState, caretakerId: string, tick: number): Record<NeedKey, number> => {
  const record = findCaretaker(state, caretakerId);
  const permille = careMultiplierPermille(presencePermilleOf(state));
  const left = {} as Record<NeedKey, number>;
  for (const need of NEED_KEYS) {
    left[need] =
      record === null
        ? 100
        : Math.round((budgetRemaining(record, need, tick, permille) * 100) / weeklyBudget(need, permille));
  }
  return left;
};

/** Why an action would restore nothing, or null if it would restore something. */
export type ZeroApplyReason =
  /** This caretaker's weekly allowance for that need is spent (SPEC §2.5). */
  | "SPENT"
  /** The need is full enough that the curve rounds to nothing (SPEC §2.6). */
  | "SATED";

/**
 * Whether an action would apply anything, and if not, which of the two very
 * different reasons is responsible. The UI had one message for both — "Makoto
 * wants someone else's attention" — which is true of a spent allowance and
 * simply false of a pet that is already full, and players read the false half
 * as the pet refusing them personally.
 *
 * Judged on the plain base magnitude, which is what a bare care action sends;
 * an item or a minigame only ever scales that up (a disliked food aside), so
 * a `SATED` verdict here is the floor, never an overstatement.
 */
export const zeroApplyReason = (
  state: PetState,
  action: CareAction,
  caretakerId: string,
  tick: number,
): ZeroApplyReason | null => {
  const magnitude = MAGNITUDE_ACTIONS[action];
  if (!magnitude) return null; // MEDICATE is flat: neither curved nor budgeted.
  const record = findCaretaker(state, caretakerId);
  const permille = careMultiplierPermille(presencePermilleOf(state));
  if (record !== null && budgetRemaining(record, magnitude.need, tick, permille) === 0) return "SPENT";
  return diminishedMagnitude(magnitude.base, state.needs[magnitude.need]) === 0 ? "SATED" : null;
};
