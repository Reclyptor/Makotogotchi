// The venue ballot (SPEC §22.9): caretakers spend coins to weight tomorrow's
// venue draw, and a funded place's shop row stops being a badge and becomes
// something the room can back.
//
// One document per pet-day, keyed by the day its tickets weight. A vote on
// day D writes the row for D+1, and once D+1 arrives its row is simply never
// written again — there is no job that rolls a ballot over, no document that
// mutates as the day turns, and a **missing row is meaningful**: nobody
// voted, so every venue holds its one base ticket. This is the same idiom
// the quest records and the weekly budget rows already use — a new day
// simply has no row yet.

import type { Collection, Db } from "mongodb";
import { BALLOT_MAX_EXTRA_TICKETS, VENUE_TICKET_COINS, type DayBallot } from "@/sim/atmosphere";
import { isDuplicateKeyError } from "./db/collections";
import { once } from "./once";

export type BallotDoc = {
  /** The pet-day these tickets weight — epoch days in the pet's zone, the
   *  same index `petClock` hands the scene. NOT days since genesis. */
  _id: number;
  /** venueId → extra tickets bought. Base tickets belong to the pool, not
   *  to the ballot, so they are not stored. */
  tickets: Record<string, number>;
  /** caretakerId → coins spent, mirroring `funding.contributors`. */
  spent: Record<string, number>;
  createdAt: Date;
};

export const ballots = (db: Db): Collection<BallotDoc> => db.collection("venueBallots");

export const ensureBallotIndexes = once(async (db: Db): Promise<void> => {
  // `_id` is the only query key. The TTL is housekeeping alone: a ballot
  // stops mattering the day after it is drawn, and thirty days is far
  // beyond any row still in play.
  await ballots(db).createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
});

export const resetBallotIndexCache = (): void => ensureBallotIndexes.reset();

/**
 * The ballots in play, for the room broadcast: yesterday's, today's closed
 * one that weights the scene on screen, and tomorrow's open one taking
 * votes. Three rather than two so a client whose clock sits either side of
 * the server's still finds its own day in the payload — clients select by
 * *matching* `forDay`, never by position, which is what makes the midnight
 * turn seamless through the room cache and a stale broadcast harmless.
 */
export const ballotsAround = async (db: Db, today: number): Promise<DayBallot[]> => {
  const days = [today - 1, today, today + 1];
  const rows = await ballots(db)
    .find({ _id: { $in: days } })
    .toArray();
  return days.map((forDay) => ({ forDay, tickets: rows.find((row) => row._id === forDay)?.tickets ?? {} }));
};

export type VoteResult =
  | { ok: true; venueId: string; tickets: number; spent: number; forDay: number }
  | { ok: false; reason: "UNKNOWN_VENUE" | "NOT_IN_ROTATION" | "BALLOT_FULL" | "INSUFFICIENT_COINS" };

/** How many tickets a request may actually buy, given the cap and the purse. */
export const clampTickets = (input: { wanted: number; held: number; balance: number }): number =>
  Math.max(
    0,
    Math.min(
      Math.floor(input.wanted),
      BALLOT_MAX_EXTRA_TICKETS - input.held,
      Math.floor(input.balance / VENUE_TICKET_COINS),
    ),
  );

/**
 * Back a venue for `forDay`.
 *
 * The order matters and is the opposite of `contribute()`'s. Funding refunds
 * its overshoot, so it can spend first and reconcile after; votes are never
 * refunded, so the failure that must be impossible here is **taking coins
 * for a ticket that did not fit**. Tickets are therefore claimed first and
 * only what lands is billed — a ticket counter briefly a few too high harms
 * nobody, because the ballot it belongs to is tomorrow's.
 *
 * The claim is an unconditional `$inc` followed by a trim, rather than a
 * `$lt` guard in the filter. That is not a style choice: Mongo's type
 * bracketing means `{ $lt: 30 }` does **not** match a missing field, so a
 * guarded filter would silently reject the first vote on every venue. The
 * trim is the same shape the funding path's overflow refund already uses.
 */
export const voteForVenue = async (
  db: Db,
  caretakerId: string,
  venueId: string,
  wanted: number,
  forDay: number,
  balance: number,
  spendCoins: (coins: number) => Promise<boolean>,
): Promise<VoteResult> => {
  await ensureBallotIndexes(db);

  try {
    await ballots(db).updateOne(
      { _id: forDay },
      { $setOnInsert: { tickets: {}, spent: {}, createdAt: new Date() } },
      { upsert: true },
    );
  } catch (error) {
    // Two upserts racing to create the row: the loser's row already exists,
    // and $setOnInsert is a no-op on it either way.
    if (!isDuplicateKeyError(error)) throw error;
  }

  const existing = await ballots(db).findOne({ _id: forDay });
  const asked = clampTickets({ wanted, held: existing?.tickets[venueId] ?? 0, balance });
  if (asked <= 0) {
    return { ok: false, reason: (existing?.tickets[venueId] ?? 0) >= BALLOT_MAX_EXTRA_TICKETS ? "BALLOT_FULL" : "INSUFFICIENT_COINS" };
  }

  const field = `tickets.${venueId}`;
  const claimed = await ballots(db).findOneAndUpdate(
    { _id: forDay },
    { $inc: { [field]: asked } },
    { returnDocument: "after" },
  );
  // $inc is atomic per document, so under any interleaving the sum is exact
  // and every racer trims its own share back to the ceiling.
  const held = claimed?.tickets[venueId] ?? asked;
  const over = Math.min(Math.max(0, held - BALLOT_MAX_EXTRA_TICKETS), asked);
  if (over > 0) await ballots(db).updateOne({ _id: forDay }, { $inc: { [field]: -over } });

  const landed = asked - over;
  if (landed <= 0) return { ok: false, reason: "BALLOT_FULL" };

  const cost = landed * VENUE_TICKET_COINS;
  if (!(await spendCoins(cost))) {
    // The purse moved between the read and the charge. Put the tickets back
    // rather than leaving a ballot nobody paid for.
    await ballots(db).updateOne({ _id: forDay }, { $inc: { [field]: -landed } });
    return { ok: false, reason: "INSUFFICIENT_COINS" };
  }
  await ballots(db).updateOne({ _id: forDay }, { $inc: { [`spent.${caretakerId}`]: cost } });

  const settled = await ballots(db).findOne({ _id: forDay });
  return { ok: true, venueId, tickets: settled?.tickets[venueId] ?? landed, spent: cost, forDay };
};
