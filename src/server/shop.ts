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
import { petClock } from "@/sim/clock";
import type { DayBallot, VenueId } from "@/sim/atmosphere";
import { ballotsAround } from "./ballot";
import { env } from "./env";
import { isDuplicateKeyError } from "./db/collections";
import { caretakerProfile, caretakers, creditCoins } from "./social";
import { invalidateRoomCache } from "./snapshot";
import { announcePurse, purseOf } from "./purse";
import { key, redis } from "./redis/client";
import type { EngineMessage } from "./engine/messages";

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

/**
 * Grand items are alike in how they are paid for and unlike in everything
 * else, so each one carries the `group` that says what funding it actually
 * does: furniture lands in the room, a style repaints it, a venue joins the
 * day-trip rotation. The shop files them by that rather than by their funding
 * model (SPEC §21.8), and the group travels with the catalog so no reader has
 * to infer a room style from the spelling of an id.
 */
export const GRAND_ITEMS = {
  window_seat: { kind: "grand", group: "decor", price: 500, label: "Window Seat" },
  aquarium: { kind: "grand", group: "decor", price: 650, label: "Aquarium" },
  kotatsu: { kind: "grand", group: "decor", price: 800, label: "Kotatsu" },
  // Room styles (SPEC §22.5). Funding one buys the whole room a new palette
  // and a new view out of the window, for everyone, forever.
  theme_cabin: { kind: "grand", group: "theme", themeId: "cabin", price: 900, label: "Log Cabin Walls" },
  theme_seaside: { kind: "grand", group: "theme", themeId: "seaside", price: 1100, label: "Seaside Walls" },
  // Day-trip venues (SPEC §22.8). Funding one opens a place the room can
  // then vote itself to (§22.9), for everyone, forever — the ids ARE the
  // venue ids, which `VENUE_CATALOG_IDS` below turns from a convention into
  // a compile error.
  blossom: { kind: "grand", group: "venue", price: 700, label: "Blossom Park" },
  beach: { kind: "grand", group: "venue", price: 800, label: "Beach Day" },
  pond: { kind: "grand", group: "venue", price: 850, label: "Koi Pond" },
  forest: { kind: "grand", group: "venue", price: 950, label: "Forest Clearing" },
  shrine: { kind: "grand", group: "venue", price: 1100, label: "Shrine Path" },
  mountain: { kind: "grand", group: "venue", price: 1400, label: "Mount Fuji" },
} as const;

/**
 * Every venue the shop sells must be a venue the scene can draw.
 *
 * Nothing else enforces that. A funded id that is not a `VenueId` is dropped
 * silently by the rotation pool's filter, so the shop would take a room's
 * coins for a place Makoto can never be sent to, and no test would notice.
 * This is a type-level assertion rather than a runtime check on purpose: it
 * costs nothing at runtime and it fails the build the day the two lists
 * drift, which is the only moment anybody could still fix it cheaply.
 */
type SoldVenueIds = { [K in GrandId]: (typeof GRAND_ITEMS)[K]["group"] extends "venue" ? K : never }[GrandId];
const _everyVenueSoldCanBeDrawn: SoldVenueIds extends VenueId ? true : never = true;

/** The style every room starts with and can always return to. */
export const DEFAULT_THEME = "cozy";

export type CosmeticId = keyof typeof COSMETIC_ITEMS;
export type DecorId = keyof typeof DECOR_ITEMS;
export type GrandId = keyof typeof GRAND_ITEMS;

export const isGrandId = (itemId: string): itemId is GrandId => itemId in GRAND_ITEMS;

export type RoomStateDoc = {
  _id: "room";
  cosmetics: string[]; // owned, cross-generation
  activeCosmetic: string | null;
  decor: string[];
  /** The room style in use; absent means the default (SPEC §22.5). */
  activeTheme?: string | null;
};

const roomCollection = (db: Db): Collection<RoomStateDoc> => db.collection("roomState");

export type RoomView = {
  decor: string[];
  activeCosmetic: string | null;
  cosmetics: string[];
  /** The style the room is wearing, and every style it may wear. */
  activeTheme: string;
  themes: string[];
  /**
   * The day ballots in play (SPEC §22.9): yesterday's, today's closed one
   * that weights the scene on screen, and tomorrow's open one taking votes.
   * Read by MATCHING `forDay`, never by position — that is what makes the
   * midnight turn seamless through this view's cache.
   */
  ballots: DayBallot[];
};

/** The style a funded item bought the room, or null if it bought something else. */
export const themeOfItem = (itemId: string): string | null => {
  if (!isGrandId(itemId)) return null;
  const item = GRAND_ITEMS[itemId];
  return item.group === "theme" ? item.themeId : null;
};

/** A funded style is owned forever; the default is owned from the start. */
export const ownedThemes = (decor: string[]): string[] => [
  DEFAULT_THEME,
  ...decor.map(themeOfItem).filter((themeId) => themeId !== null),
];

export const roomState = async (db: Db): Promise<RoomView> => {
  const today = petClock(env().PET_TIMEZONE, Date.now()).dayIndex;
  const [doc, dayBallots] = await Promise.all([roomCollection(db).findOne({ _id: "room" }), ballotsAround(db, today)]);
  const decor = doc?.decor ?? [];
  const themes = ownedThemes(decor);
  const active = doc?.activeTheme ?? DEFAULT_THEME;
  return {
    decor,
    activeCosmetic: doc?.activeCosmetic ?? null,
    cosmetics: doc?.cosmetics ?? [],
    // A style the room no longer owns cannot be worn — fall back rather than
    // render a palette nobody paid for.
    activeTheme: themes.includes(active) ? active : DEFAULT_THEME,
    themes,
    ballots: dayBallots,
  };
};

/**
 * The room changed: drop the cached copy and tell everyone what it is now
 * (SPEC §7.2, §22.5).
 *
 * Every mutation below calls this instead of invalidating alone. Invalidating
 * only fixes what the *next* snapshot serves, which is up to a whole
 * SNAPSHOT_INTERVAL away — long enough that a hat you just put on does not
 * appear, on your own screen, for half a minute. The room is shared, so its
 * changes are announced the same way the pet's are.
 */
const announceRoom = async (db: Db): Promise<void> => {
  invalidateRoomCache();
  const room = await roomState(db);
  const message: EngineMessage = { type: "room", room };
  try {
    await redis().publish(key("events"), JSON.stringify(message));
  } catch {
    // The room is right in the database; only its echo was lost, and the next
    // snapshot carries it anyway.
  }
};

/**
 * Switch the room's style (SPEC §22.5). Any caretaker may change it among
 * the styles the room owns — it is a shared space, and the change lands for
 * everyone at once.
 */
export const setActiveTheme = async (db: Db, themeId: string): Promise<boolean> => {
  const doc = await roomCollection(db).findOne({ _id: "room" });
  if (!ownedThemes(doc?.decor ?? []).includes(themeId)) return false;
  await roomCollection(db).updateOne(
    { _id: "room" },
    { $set: { activeTheme: themeId }, $setOnInsert: { cosmetics: [], activeCosmetic: null, decor: [] } },
    { upsert: true },
  );
  await announceRoom(db);
  return true;
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
  const updated = await caretakers(db).findOneAndUpdate(
    { _id: caretakerId, coins: { $gte: price } },
    { $inc: { coins: -price, ...alsoInc } },
    { returnDocument: "after" },
  );
  // Null means the filter did not match, i.e. the balance was short — nothing
  // moved, so there is nothing to announce.
  if (updated === null) return false;
  await announcePurse(caretakerId, purseOf(updated));
  return true;
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
  // Buying is a redecoration like any other. Without this the room document
  // has changed and every snapshot keeps serving the cached one for up to its
  // whole TTL — a plant paid for and not standing in the room, a hat bought
  // and not worn, for ten seconds (SPEC §22.5).
  if (item.kind === "cosmetic" || item.kind === "decor") await announceRoom(db);
  return { ok: true, kind: item.kind };
};

/** Switch the worn cosmetic among owned ones — free. */
export const wearCosmetic = async (db: Db, itemId: string | null): Promise<boolean> => {
  if (itemId === null) {
    await roomCollection(db).updateOne({ _id: "room" }, { $set: { activeCosmetic: null } });
    await announceRoom(db);
    return true;
  }
  const result = await roomCollection(db).updateOne({ _id: "room", cosmetics: itemId }, { $set: { activeCosmetic: itemId } });
  if (result.modifiedCount === 1) await announceRoom(db);
  return result.modifiedCount === 1;
};

/** Consume one unit of a consumable; false if none owned. */
export const consumeItem = async (db: Db, caretakerId: string, itemId: string): Promise<boolean> => {
  const updated = await caretakers(db).findOneAndUpdate(
    { _id: caretakerId, [`inventory.${itemId}`]: { $gte: 1 } },
    { $inc: { [`inventory.${itemId}`]: -1 } },
    { returnDocument: "after" },
  );
  if (updated === null) return false;
  await announcePurse(caretakerId, purseOf(updated));
  return true;
};

export const refundItem = async (db: Db, caretakerId: string, itemId: string): Promise<void> => {
  const updated = await caretakers(db).findOneAndUpdate(
    { _id: caretakerId },
    { $inc: { [`inventory.${itemId}`]: 1 } },
    { returnDocument: "after" },
  );
  await announcePurse(caretakerId, purseOf(updated));
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
  await announceRoom(db);
};
