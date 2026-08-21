// Leader-side want lifecycle (SPEC §25.2). The sim's wantAt is schedule-free
// by design; this module is where the leader supplies what the sim lacks —
// the real waking-hours schedule — and drives the two fold events through
// the engine. Every append is re-validated under the write lock by the
// engine's prepare callback, so this observer needs no guard state of its
// own: it merely avoids taking the lock when the settled state already shows
// nothing to do.

import type { Db } from "mongodb";
import { isAlive, phaseAt, type Generation, type PetState } from "@/sim/model";
import { WANT_REWARD_COINS, WANT_WINDOW_TICKS, wantAt, windowEndTick, windowIndexAt } from "@/sim/wants";
import type { Milestone } from "@/sim/events";
import { creditCoins } from "./social";
import { scheduleFor } from "./schedule";
import type { PetEngine } from "./engine/engine";

/**
 * Pay the caretaker who granted a wish (SPEC §25.4). Both write routes —
 * /api/care and /api/play — funnel accepted actions through this after
 * their contribution ledger roll. The reducer's once-per-window settlement
 * makes this at-most-once with no marker: the milestone appears on exactly
 * one care outcome per window. Returns the coins granted for the response.
 */
export const settleWantFulfillment = async (
  database: Db,
  caretakerId: string,
  milestones: readonly Milestone[],
): Promise<number> => {
  if (!milestones.some((milestone) => milestone.kind === "WANT_FULFILLED")) return 0;
  await creditCoins(database, caretakerId, WANT_REWARD_COINS);
  return WANT_REWARD_COINS;
};

/**
 * A want may only open in a window that sits fully inside scheduled waking
 * hours (SPEC §25.1) — the pet should never be asked for a FEED it is asleep
 * for. Endpoint checks alone would suffice today (the sleep span dwarfs a
 * window), but the boundary scan keeps the claim total rather than assumed.
 */
export const windowIsScheduledAwake = (genesisEpochMs: number, windowIndex: number, timeZone: string): boolean => {
  const start = windowIndex * WANT_WINDOW_TICKS;
  const end = windowEndTick(windowIndex);
  const schedule = scheduleFor(genesisEpochMs, start, end, timeZone);
  if (phaseAt(schedule, start) !== "WAKE") return false;
  return !schedule.boundaries.some((boundary) => boundary.tick > start && boundary.tick < end);
};

/**
 * One observation of the settled state: expire a stale want first — late is
 * legal, and a newer window must never open over an unsettled older one —
 * then open the current window's want if the draw brought one. Returns the
 * latest state so the caller's push dispatcher observes post-want truth.
 */
export const observeWants = async (
  engine: PetEngine,
  generation: Generation,
  state: PetState,
  timeZone: string,
): Promise<PetState> => {
  let latest = state;
  if (!isAlive(latest)) return latest;

  const open = latest.wantOpen;
  if (open != null && latest.tick >= windowEndTick(open.window)) {
    latest = await engine.expireWant(generation);
  }

  if (latest.wantOpen == null) {
    const windowIndex = windowIndexAt(latest.tick);
    const settled = latest.wantSettledWindow ?? null;
    if (settled === null || windowIndex > settled) {
      const want = wantAt(generation.seed, windowIndex);
      if (want && windowIsScheduledAwake(generation.genesisEpochMs, windowIndex, timeZone)) {
        latest = await engine.openWant(generation, windowIndex, want);
      }
    }
  }

  return latest;
};
