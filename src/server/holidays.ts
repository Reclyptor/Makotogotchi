// The ballot refund for a holiday (SPEC §22.11): a holiday keeps Makoto home,
// so tickets bought for it before the vote closed buy nothing, and the one
// day §22.9's "never refunded" gives way.
//
// Claimed before anyone is paid, exactly as the Sage's ascension is: the
// marker's _id names the day, so a second leader — or the same leader after a
// restart — loses the insert and pays nobody twice. Losing the process
// between the claim and the payout costs those coins; paying first would
// cost them twice.

import type { Collection, Db } from "mongodb";
import { holidayOn } from "@/sim/holidays";
import { ballots } from "./ballot";
import { isDuplicateKeyError } from "./db/collections";
import { creditCoins } from "./social";

export type HolidayRefundDoc = {
  /** `holiday-refund:${dayIndex}` — the claim is the primary key. */
  _id: string;
  caretakers: string[];
  paidAt: Date;
};

export const holidayRefundMarkers = (db: Db): Collection<HolidayRefundDoc> => db.collection("holidayRefunds");

/**
 * The leader's check. Returns who was refunded, or null if today is no
 * holiday or it was settled before.
 */
export const settleHolidayRefund = async (db: Db, today: number): Promise<string[] | null> => {
  if (!holidayOn(today)) return null;
  const markers = holidayRefundMarkers(db);
  const id = `holiday-refund:${today}`;
  // The cheap read keeps every later tick of the holiday off the ballot row.
  if ((await markers.findOne({ _id: id })) !== null) return null;

  const spent = (await ballots(db).findOne({ _id: today }))?.spent ?? {};
  const refunds = Object.entries(spent)
    .filter(([, coins]) => coins > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const paid = refunds.map(([caretakerId]) => caretakerId);
  try {
    await markers.insertOne({ _id: id, caretakers: paid, paidAt: new Date() });
  } catch (error) {
    if (isDuplicateKeyError(error)) return null; // another leader claimed it
    throw error;
  }
  for (const [caretakerId, coins] of refunds) {
    await creditCoins(db, caretakerId, coins);
  }
  return paid;
};
