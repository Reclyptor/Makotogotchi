// Push subscription persistence (SPEC §12). One row per browser endpoint; a
// caretaker with three devices has three rows. Endpoints that the push
// service reports gone (404/410) are pruned on send.

import type { Collection, Db } from "mongodb";

export type PushSubscriptionDoc = {
  caretakerId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
};

export const pushSubscriptions = (db: Db): Collection<PushSubscriptionDoc> => db.collection("pushSubscriptions");

let ensured = false;
export const ensurePushIndexes = async (db: Db): Promise<void> => {
  if (ensured) return;
  await Promise.all([
    pushSubscriptions(db).createIndex({ endpoint: 1 }, { unique: true }),
    pushSubscriptions(db).createIndex({ caretakerId: 1 }),
  ]);
  ensured = true;
};

export const resetPushIndexCache = (): void => {
  ensured = false;
};

export const saveSubscription = async (
  db: Db,
  caretakerId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> => {
  await ensurePushIndexes(db);
  await pushSubscriptions(db).updateOne(
    { endpoint: subscription.endpoint },
    { $set: { caretakerId, keys: subscription.keys }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
};

export const deleteSubscription = async (db: Db, endpoint: string): Promise<void> => {
  await pushSubscriptions(db).deleteOne({ endpoint });
};

export const hasSubscription = async (db: Db, caretakerId: string): Promise<boolean> => {
  await ensurePushIndexes(db);
  return (await pushSubscriptions(db).countDocuments({ caretakerId }, { limit: 1 })) > 0;
};

export const allSubscriptions = async (db: Db): Promise<PushSubscriptionDoc[]> => {
  await ensurePushIndexes(db);
  return pushSubscriptions(db).find({}).toArray();
};
