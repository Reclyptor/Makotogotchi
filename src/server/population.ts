// How many people are actually looking after the pet (SPEC §23.1).
//
// "Active" means a recorded care action inside the caretaker budget's own
// rolling window: the people who supply the care are exactly the people who
// should set the demand. Spectators do not count — a lurker who raises the
// difficulty without restoring anything would only punish the carers.

import type { Db } from "mongodb";
import { petDay } from "@/sim/score";
import { BUDGET_WINDOW_DAYS } from "@/sim/tuning";
import { contributions } from "./social";

/** Distinct caretakers who cared within the budget window ending at `tick`. */
export const activeCaretakers = async (db: Db, tick: number): Promise<number> => {
  const since = petDay(tick) - (BUDGET_WINDOW_DAYS - 1);
  // Contributions are indexed by day, so this is a bounded scan of one week
  // however long the generation has run.
  const ids = await contributions(db).distinct("caretakerId", { day: { $gte: since } });
  return ids.length;
};
