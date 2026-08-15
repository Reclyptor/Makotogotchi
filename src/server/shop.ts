// The shop (SPEC §13.2). Sim-relevant items (food, medicine, toys) price
// from src/sim/economy; cosmetics and room decor are purely visual and
// live entirely here, in one communal room document — spending on them is
// a form of contribution everyone sees.

import type { Collection, Db } from "mongodb";
import { FOOD_ITEMS, MEDICINE_ITEMS, TOY_ITEMS } from "@/sim/economy";
import { caretakers } from "./social";

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

export type CosmeticId = keyof typeof COSMETIC_ITEMS;
export type DecorId = keyof typeof DECOR_ITEMS;

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
