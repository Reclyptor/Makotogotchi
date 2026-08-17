// How many people are actually looking after the pet (SPEC §23.1).
//
// "Active" means a recorded care action inside the caretaker budget's own
// window: the people who supply the care are exactly the people who should
// set the demand. Spectators do not count — a lurker who raises the
// difficulty without restoring anything would only punish the carers.
//
// The window is bucketed by pet-day, not continuous. It holds seven day
// buckets and advances one at each pet-midnight, so the effective lookback
// oscillates between six and seven days and a cohort ages out all at once.
// That is deliberate: it is character-for-character the arithmetic
// `budgetRemaining` uses, so supply and demand share their boundaries and
// step together rather than drifting out of phase. `contributions` stores a
// day rather than a tick, so this is also the only window the schema
// supports without a backfill.

import type { Db } from "mongodb";
import { petDay } from "@/sim/score";
import { BUDGET_WINDOW_DAYS } from "@/sim/tuning";
import { contributions } from "./social";

/** Distinct caretakers who cared in the seven day-buckets ending at `tick`. */
export const activeCaretakers = async (db: Db, tick: number): Promise<number> => {
  const since = petDay(tick) - (BUDGET_WINDOW_DAYS - 1);
  // Contributions are indexed by day, so this is a bounded scan of one week
  // however long the generation has run.
  const ids = await contributions(db).distinct("caretakerId", { day: { $gte: since } });
  return ids.length;
};
