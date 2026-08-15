// Contribution scoring and the per-caretaker rolling restoration budget
// (SPEC §2.5, §2.11). The budget rings live inside PetState and fold from
// events like everything else; helpers here mutate a working draft that
// reduce() owns — they are never handed an input state directly.

import type { BudgetDay, CaretakerRecord, PetState } from "./model";
import { BUDGET_WINDOW_DAYS, CONTRIBUTION_WEIGHTS, SCORE_DIVISOR, TICKS_PER_DAY, WEEKLY_BUDGET, type CareAction, type NeedKey } from "./tuning";

export const petDay = (tick: number): number => Math.floor(tick / TICKS_PER_DAY);

/** Find or insert (sorted by id — canonical order for replay determinism). */
export const caretakerRecord = (draft: PetState, caretakerId: string): CaretakerRecord => {
  let low = 0;
  let high = draft.caretakers.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (draft.caretakers[mid]!.id < caretakerId) low = mid + 1;
    else high = mid;
  }
  const found = draft.caretakers[low];
  if (found && found.id === caretakerId) return found;
  const record: CaretakerRecord = { id: caretakerId, lastActionTick: {}, budget: {} };
  draft.caretakers.splice(low, 0, record);
  return record;
};

const pruneRing = (ring: BudgetDay[], day: number): void => {
  const oldest = day - (BUDGET_WINDOW_DAYS - 1);
  while (ring.length > 0 && ring[0]!.day < oldest) ring.shift();
};

/** How much applied restoration this caretaker has left for a need right now. */
export const budgetRemaining = (record: CaretakerRecord, need: NeedKey, tick: number): number => {
  const day = petDay(tick);
  const oldest = day - (BUDGET_WINDOW_DAYS - 1);
  let spent = 0;
  for (const entry of record.budget[need] ?? []) {
    if (entry.day >= oldest) spent += entry.applied;
  }
  const remaining = WEEKLY_BUDGET[need] - spent;
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
