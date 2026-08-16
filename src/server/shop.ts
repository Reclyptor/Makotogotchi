// The shop (SPEC §13.2). Sim-relevant items (food, medicine, toys) price
// from src/sim/economy; cosmetics and room decor are purely visual and
// live entirely here, in one communal room document — spending on them is
// a form of contribution everyone sees.
//
// Grand items (SPEC §21.8) go one step further: nobody can afford them
// alone. Coins go into a pool instead of a purchase, and when the pool
// clears the price the item becomes room decor for everyone, forever. The
// pool row is kept afterwards — generations remember who built the room.

import type { Collection, Db } from "mongodb";
import { FOOD_ITEMS, MEDICINE_ITEMS, TOY_ITEMS } from "@/sim/economy";
import { isDuplicateKeyError } from "./db/collections";
import { caretakerProfile, caretakers, creditCoins } from "./social";

export const COSMETIC_ITEMS = {
  bow: { kind: "cosmetic", price: 300, label: "Ribbon Bow" },
  cap: { kind: "cosmetic", price: 500, label: "Tiny Cap" },
  crown: { kind: "cosmetic", price: 1500, label: "Royal Crown" },
} as const;

export const DECOR_ITEMS = {
  plant: { kind: "decor", price: 400, label: "Potted Plant" },
  picture: { kind: "decor", price: 600, label: "Framed Picture" },
  lamp: { kind: "decor", price: 800, label: "Cozy Lamp" },
} as const;

export const GRAND_ITEMS = {
  window_seat: { kind: "grand", price: 500, label: "Window Seat" },
  aquarium: { kind: "grand", price: 650, label: "Aquarium" },
  kotatsu: { kind: "grand", price: 800, label: "Kotatsu" },
} as const;

export type CosmeticId = keyof typeof COSMETIC_ITEMS;
export type DecorId = keyof typeof DECOR_ITEMS;
export type GrandId = keyof typeof GRAND_ITEMS;

export const isGrandId = (itemId: string): itemId is GrandId => itemId in GRAND_ITEMS;

export type RoomStateDoc = {
  _id: "room";
  cosmetics: string[]; // owned, cross-generation
  activeCosmetic: string | null;
  decor: string[];
};

const roomCollection = (db: Db): Collection<RoomStateDoc> => db.collection("roomState");

export type RoomView = { decor: string[]; activeCosmetic: string | null; cosmetics: string[] };

export const roomState = async (db: Db): Promise<RoomView> => {
  const doc = await roomCollection(db).findOne({ _id: "room" });
  return { decor: doc?.decor ?? [], activeCosmetic: doc?.activeCosmetic ?? null, cosmetics: doc?.cosmetics ?? [] };
};

/** All purchasable items with prices, for the shop UI. */
export const catalog = () => ({
  food: FOOD_ITEMS,
  medicine: MEDICINE_ITEMS,
  toys: TOY_ITEMS,
  cosmetics: COSMETIC_ITEMS,
  decor: DECOR_ITEMS,
  grand: GRAND_ITEMS,
});

export type PurchaseResult =
  | { ok: true; kind: "consumable" | "toy" | "cosmetic" | "decor" }
  | { ok: false; reason: "UNKNOWN_ITEM" | "INSUFFICIENT_COINS" | "ALREADY_OWNED" };

type ItemKind = "consumable" | "toy" | "cosmetic" | "decor";

const priceOf = (itemId: string): { price: number; kind: ItemKind } | null => {
  if (itemId in FOOD_ITEMS) return { price: FOOD_ITEMS[itemId as keyof typeof FOOD_ITEMS].price, kind: "consumable" };
  if (itemId in MEDICINE_ITEMS) return { price: MEDICINE_ITEMS[itemId as keyof typeof MEDICINE_ITEMS].price, kind: "consumable" };
  if (itemId in TOY_ITEMS) return { price: TOY_ITEMS[itemId as keyof typeof TOY_ITEMS].price, kind: "toy" };
  if (itemId in COSMETIC_ITEMS) return { price: COSMETIC_ITEMS[itemId as CosmeticId].price, kind: "cosmetic" };
  if (itemId in DECOR_ITEMS) return { price: DECOR_ITEMS[itemId as DecorId].price, kind: "decor" };
  return null;
};

/** Atomically spend coins; the filter is the balance check. */
const spendCoins = async (db: Db, caretakerId: string, price: number, alsoInc: Record<string, number> = {}): Promise<boolean> => {
  const result = await caretakers(db).updateOne(
    { _id: caretakerId, coins: { $gte: price } },
    { $inc: { coins: -price, ...alsoInc } },
  );
  return result.modifiedCount === 1;
};

export const purchase = async (
  db: Db,
  caretakerId: string,
  itemId: string,
  context: { installedToys: readonly string[] },
): Promise<PurchaseResult> => {
  const item = priceOf(itemId);
  if (!item) return { ok: false, reason: "UNKNOWN_ITEM" };

  if (item.kind === "toy" && context.installedToys.includes(itemId)) {
    return { ok: false, reason: "ALREADY_OWNED" };
  }
  if (item.kind === "cosmetic" || item.kind === "decor") {
    const room = await roomState(db);
    const owned = item.kind === "cosmetic" ? room.cosmetics : room.decor;
    if (owned.includes(itemId)) return { ok: false, reason: "ALREADY_OWNED" };
  }

  const consumableInc = item.kind === "consumable" ? { [`inventory.${itemId}`]: 1 } : {};
  if (!(await spendCoins(db, caretakerId, item.price, consumableInc))) {
    return { ok: false, reason: "INSUFFICIENT_COINS" };
  }

  if (item.kind === "cosmetic") {
    await roomCollection(db).updateOne(
      { _id: "room" },
      { $addToSet: { cosmetics: itemId }, $set: { activeCosmetic: itemId }, $setOnInsert: { decor: [] } },
      { upsert: true },
    );
  } else if (item.kind === "decor") {
    await roomCollection(db).updateOne(
      { _id: "room" },
      { $addToSet: { decor: itemId }, $setOnInsert: { cosmetics: [], activeCosmetic: null } },
      { upsert: true },
    );
  }
  return { ok: true, kind: item.kind };
};

/** Switch the worn cosmetic among owned ones — free. */
export const wearCosmetic = async (db: Db, itemId: string | null): Promise<boolean> => {
  if (itemId === null) {
    await roomCollection(db).updateOne({ _id: "room" }, { $set: { activeCosmetic: null } });
    return true;
  }
  const result = await roomCollection(db).updateOne({ _id: "room", cosmetics: itemId }, { $set: { activeCosmetic: itemId } });
  return result.modifiedCount === 1;
};

/** Consume one unit of a consumable; false if none owned. */
export const consumeItem = async (db: Db, caretakerId: string, itemId: string): Promise<boolean> => {
  const result = await caretakers(db).updateOne(
    { _id: caretakerId, [`inventory.${itemId}`]: { $gte: 1 } },
    { $inc: { [`inventory.${itemId}`]: -1 } },
  );
  return result.modifiedCount === 1;
};

export const refundItem = async (db: Db, caretakerId: string, itemId: string): Promise<void> => {
  await caretakers(db).updateOne({ _id: caretakerId }, { $inc: { [`inventory.${itemId}`]: 1 } });
};

// ── Co-op purchases (SPEC §21.8) ────────────────────────────────────────────

export type FundingDoc = {
  /** The grand item's id — one pool per item, kept after it is funded. */
  _id: string;
  pooled: number;
  contributors: Record<string, number>;
  fundedAt: Date | null;
};

const fundingCollection = (db: Db): Collection<FundingDoc> => db.collection("funding");

export type FundingView = { itemId: string; label: string; price: number; pooled: number; funded: boolean };

export const fundingState = async (db: Db): Promise<FundingView[]> => {
  const pools = await fundingCollection(db).find({}).toArray();
  return Object.entries(GRAND_ITEMS).map(([itemId, item]) => {
    const pool = pools.find((candidate) => candidate._id === itemId);
    return {
      itemId,
      label: item.label,
      price: item.price,
      pooled: Math.min(pool?.pooled ?? 0, item.price),
      funded: pool?.fundedAt != null,
    };
  });
};

/**
 * How much of an offered contribution can actually land: never more than the
 * giver has, and never more than the pool still needs.
 */
export const clampContribution = (input: { offered: number; pooled: number; price: number; balance: number }): number =>
  Math.max(0, Math.min(Math.floor(input.offered), input.price - input.pooled, input.balance));

/** How far a pool overshot its price — always refunded to whoever overshot. */
export const fundingOverflow = (pooled: number, price: number): number => Math.max(0, pooled - price);

export type ContributeResult =
  | {
      ok: true;
      itemId: GrandId;
      label: string;
      spent: number;
      pooled: number;
      price: number;
      /** True only for the contribution that pushed the pool over the line. */
      funded: boolean;
      /** Top three givers, biggest first — the ones the feed names. */
      top: { caretakerId: string; amount: number }[];
    }
  | { ok: false; reason: "UNKNOWN_ITEM" | "ALREADY_FUNDED" | "INSUFFICIENT_COINS" };

export const contribute = async (
  db: Db,
  caretakerId: string,
  itemId: string,
  offered: number | "all",
): Promise<ContributeResult> => {
  if (!isGrandId(itemId)) return { ok: false, reason: "UNKNOWN_ITEM" };
  const item = GRAND_ITEMS[itemId];

  const pool = await fundingCollection(db).findOne({ _id: itemId });
  if (pool?.fundedAt != null) return { ok: false, reason: "ALREADY_FUNDED" };

  const pooled = pool?.pooled ?? 0;
  const balance = (await caretakerProfile(db, caretakerId))?.coins ?? 0;
  const wanted = offered === "all" ? item.price - pooled : offered;
  const spend = clampContribution({ offered: wanted, pooled, price: item.price, balance });
  if (spend <= 0 || !(await spendCoins(db, caretakerId, spend))) {
    return { ok: false, reason: "INSUFFICIENT_COINS" };
  }

  const updated = await fundingCollection(db).findOneAndUpdate(
    { _id: itemId },
    { $inc: { pooled: spend, [`contributors.${caretakerId}`]: spend }, $setOnInsert: { fundedAt: null } },
    { upsert: true, returnDocument: "after" },
  );
  let landed = spend;
  let total = updated?.pooled ?? pooled + spend;

  // Two people can clear the last stretch at the same moment; whoever ends up
  // over the price gets the excess back rather than gifting it to the void.
  const overflow = Math.min(fundingOverflow(total, item.price), spend);
  if (overflow > 0) {
    await creditCoins(db, caretakerId, overflow);
    const trimmed = await fundingCollection(db).findOneAndUpdate(
      { _id: itemId },
      { $inc: { pooled: -overflow, [`contributors.${caretakerId}`]: -overflow } },
      { returnDocument: "after" },
    );
    landed -= overflow;
    total = trimmed?.pooled ?? total - overflow;
  }

  const claimed = await fundingCollection(db).findOneAndUpdate(
    { _id: itemId, fundedAt: null, pooled: { $gte: item.price } },
    { $set: { fundedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (claimed) await placeCommunalDecor(db, itemId);

  const contributors = claimed?.contributors ?? updated?.contributors ?? {};
  const top = Object.entries(contributors)
    .map(([id, amount]) => ({ caretakerId: id, amount }))
    .sort((a, b) => b.amount - a.amount || a.caretakerId.localeCompare(b.caretakerId))
    .slice(0, 3);

  return { ok: true, itemId, label: item.label, spent: landed, pooled: total, price: item.price, funded: claimed !== null, top };
};

/** A funded grand item joins the room through the ordinary decor path. */
const placeCommunalDecor = async (db: Db, itemId: string): Promise<void> => {
  try {
    await roomCollection(db).updateOne(
      { _id: "room" },
      { $addToSet: { decor: itemId }, $setOnInsert: { cosmetics: [], activeCosmetic: null } },
      { upsert: true },
    );
  } catch (error) {
    // Two upserts racing to create the room document: the loser's item is
    // already there, because $addToSet on the winner's document ran first.
    if (!isDuplicateKeyError(error)) throw error;
  }
};
