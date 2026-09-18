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
//
// Two numbers come out of it, because two different questions are being
// asked: how many named people helped this week, which is what the UI says,
// and how many caretakers' worth of *week* they add up to, which is what
// difficulty reads.

import type { Db } from "mongodb";
import { petDay } from "@/sim/score";
import { PRESENCE_SCALE } from "@/sim/difficulty";
import { BUDGET_WINDOW_DAYS } from "@/sim/tuning";
import { caretakers, contributions } from "./social";

export type Population = {
  /** Distinct named caretakers who cared inside the window. */
  named: number;
  /**
   * The same people weighted by how much of the window each was present for,
   * in thousandths of a caretaker: seven days of presence is one caretaker,
   * one day is a seventh of one.
   */
  presencePermille: number;
};

/**
 * The caring community in the seven day-buckets ending at `tick`.
 *
 * **Named**, because a caretaker is a cookie and a person has several: ten
 * people once read as fifty-three. A nickname is unique and set once per
 * person, so it is the closest thing the game has to a person.
 *
 * **Presence-weighted**, because attendance is not supply. The rule this
 * replaces counted anyone who acted even once as a full member of the
 * community for the whole following week, so a crowd that looked in on a
 * Monday — a link shared somewhere, a wave of curiosity — set the bar for
 * six more days after it had gone, and the people who actually stayed were
 * left carrying a pet tuned for a party that had ended. Presence answers the
 * question difficulty is really asking: how many caretakers' worth of week
 * does this pet have? Someone here every day is one; someone who looked in
 * once is a seventh of one. Nobody is turned away and nobody is discounted
 * for being new — a visitor who keeps visiting becomes a whole caretaker at
 * exactly the rate they become one.
 *
 * Both figures come from one pass. Days are deduplicated before they are
 * counted, because `contributions` is keyed by generation as well as day, and
 * a generation that ended mid-week would otherwise let one day count twice.
 */
export const activeCaretakers = async (db: Db, tick: number): Promise<Population> => {
  const since = petDay(tick) - (BUDGET_WINDOW_DAYS - 1);
  // Contributions are indexed by day, so this is a bounded scan of one week
  // however long the generation has run.
  const perCaretaker = await contributions(db)
    .aggregate<{ _id: string; days: number }>([
      { $match: { day: { $gte: since } } },
      { $group: { _id: { caretakerId: "$caretakerId", day: "$day" } } },
      { $group: { _id: "$_id.caretakerId", days: { $sum: 1 } } },
    ])
    .toArray();
  if (perCaretaker.length === 0) return { named: 0, presencePermille: 0 };

  const named = new Set(
    await caretakers(db).distinct("_id", {
      _id: { $in: perCaretaker.map((row) => row._id) },
      nickname: { $ne: null },
    }),
  );
  const present = perCaretaker.filter((row) => named.has(row._id));
  // A caretaker can be present on at most the window's own days; clamping
  // says so rather than trusting the match to have said it.
  const caretakerDays = present.reduce((total, row) => total + Math.min(row.days, BUDGET_WINDOW_DAYS), 0);
  return {
    named: present.length,
    // Integer throughout (SPEC §4.2): thousandths of a caretaker, rounded
    // once, never a fraction carried around as a float.
    presencePermille: Math.round((caretakerDays * PRESENCE_SCALE) / BUDGET_WINDOW_DAYS),
  };
};
