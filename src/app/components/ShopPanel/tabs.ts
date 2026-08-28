// What the shop shows, decided before anything is drawn (SPEC §13.2).
//
// Every row in every tab comes out of here, already knowing its name, its
// detail line, and whether its action can be taken — so the panel below is
// only a renderer, and the two failures this shop kept having become
// impossible: a category with no heading, and a button that looks live until
// the server says no.
//
// Items are filed by what they DO, not by how they are paid for. A grand
// item's pool is a state its row is in (SPEC §21.8), which is why funding a
// wall style and switching to it are the same row at two moments of its life
// rather than two rows in two sections.

import { THEMES } from "@/game/scene/backdrop";
import { canPerform } from "@/sim/validate";
import type { PetState, ProjectionContext } from "@/sim/model";
import type { catalog, FundingView, RoomView } from "@/server/shop";
import { rejectionText } from "../ActionBar/copy";

export type ShopCatalog = ReturnType<typeof catalog>;

/** Everything the shop knows about the world it is selling into. */
export type ShopModel = {
  catalog: ShopCatalog;
  coins: number;
  inventory: Partial<Record<string, number>>;
  room: RoomView;
  toys: readonly string[];
  funding: readonly FundingView[];
};

/** What the pet's own rules say about acting on it right now. */
export type CareGate = {
  state: PetState;
  ctx: ProjectionContext;
  caretakerId: string;
  petName: string;
};

/** Can this be done, and if not, why — in words a player reads. */
export type Availability = { ok: true } | { ok: false; note: string };

/** One offer on an open pool: what it says, what it costs, what it posts. */
export type FundOffer = {
  amount: 10 | 50 | "all";
  label: string;
  coins: number;
  availability: Availability;
};

export type ShopRowAction =
  | { kind: "buy"; itemId: string; price: number; availability: Availability }
  | { kind: "use"; itemId: string; care: "FEED" | "MEDICATE"; availability: Availability }
  | { kind: "wear"; itemId: string | null; label: string }
  | { kind: "theme"; themeId: string }
  | { kind: "fund"; itemId: string; offers: FundOffer[] }
  | { kind: "badge"; label: string };

export type ShopRow = {
  id: string;
  icon: string;
  name: string;
  detail: string;
  action: ShopRowAction;
  /** An open pool, drawn as a progress track beneath the name. */
  pool?: { pooled: number; price: number };
};

export type ShopGroup = { id: string; heading?: string; rows: ShopRow[] };

export type TabId = "pack" | "food" | "toys" | "style" | "room";

export type ShopTab = {
  id: TabId;
  label: string;
  /** A count worth showing on the tab itself — the pack's, and only its. */
  badge?: number;
  groups: ShopGroup[];
  /** Shown when every group is empty. */
  empty?: string;
  /** One quiet line under the rows it applies to. */
  footnote?: string;
};

const ITEM_ICONS: Record<string, string> = {
  pepper_treat: "🌶️",
  fish_feast: "🐟",
  super_medicine: "💊",
  teeter: "🛝",
  wheel: "🎡",
  bow: "🎀",
  cap: "🧢",
  crown: "👑",
  plant: "🪴",
  picture: "🖼️",
  lamp: "💡",
  window_seat: "🪟",
  aquarium: "🐠",
  kotatsu: "♨️",
  theme_cabin: "🪵",
  theme_seaside: "🌊",
  beach: "🏖️",
  forest: "🌲",
};

const icon = (itemId: string, fallback: string): string => ITEM_ICONS[itemId] ?? fallback;

type GrandItem = ShopCatalog["grand"][keyof ShopCatalog["grand"]];

/** The style a grand item sells, or null when it sells something else. */
const themeIdOf = (item: GrandItem): string | null => (item.group === "theme" ? item.themeId : null);

const affordable = (coins: number, price: number): Availability =>
  coins >= price ? { ok: true } : { ok: false, note: `Needs ${price - coins} more 🪙` };

/** The pet's own rules, asked the same way the server asks them (SPEC §4.1). */
const usable = (gate: CareGate, care: "FEED" | "MEDICATE", itemId: string): Availability => {
  const verdict = canPerform(gate.state, care, gate.caretakerId, gate.ctx, itemId);
  return verdict.ok ? { ok: true } : { ok: false, note: rejectionText(gate.petName)[verdict.reason] };
};

const buyRow = (
  itemId: string,
  item: { label: string; price: number },
  detail: string,
  shop: ShopModel,
  fallbackIcon: string,
): ShopRow => ({
  id: itemId,
  icon: icon(itemId, fallbackIcon),
  name: item.label,
  detail,
  action: { kind: "buy", itemId, price: item.price, availability: affordable(shop.coins, item.price) },
});

const badgeRow = (row: ShopRow, label: string, detail: string): ShopRow => ({
  ...row,
  detail,
  action: { kind: "badge", label },
});

/**
 * The offers on an open pool. The last stretch collapses to one button rather
 * than showing a +50 that can only spend the 30 the pool still needs — the
 * server clamps it either way, but a button should say what it does.
 */
const fundOffers = (remaining: number, coins: number): FundOffer[] => {
  if (remaining <= 50) {
    return [{ amount: "all", label: "Finish it", coins: remaining, availability: affordable(coins, remaining) }];
  }
  return ([10, 50] as const).map((amount) => ({
    amount,
    label: `+${amount}`,
    coins: amount,
    availability: affordable(coins, amount),
  }));
};

/** A grand item's row, in whichever of its two lives it is currently in. */
const grandRow = (
  itemId: string,
  name: string,
  shop: ShopModel,
  fallbackIcon: string,
  copy: { open: string; funded: string; fundedBadge: string },
): ShopRow => {
  const pool = shop.funding.find((candidate) => candidate.itemId === itemId);
  const identity = { id: itemId, icon: icon(itemId, fallbackIcon), name };
  if (pool === undefined || pool.funded) {
    return { ...identity, detail: copy.funded, action: { kind: "badge", label: copy.fundedBadge } };
  }
  return {
    ...identity,
    detail: copy.open,
    action: { kind: "fund", itemId, offers: fundOffers(pool.price - pool.pooled, shop.coins) },
    pool: { pooled: pool.pooled, price: pool.price },
  };
};

const packTab = (shop: ShopModel, gate: CareGate): ShopTab => {
  const rows = Object.entries(shop.inventory)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([itemId, count]): ShopRow => {
      const medicine = itemId in shop.catalog.medicine;
      const care = medicine ? "MEDICATE" : "FEED";
      const availability = usable(gate, care, itemId);
      return {
        id: itemId,
        icon: icon(itemId, medicine ? "💊" : "🍖"),
        name: `${itemLabel(shop.catalog, itemId)} ×${count}`,
        detail: medicine ? "Cures instantly, no cooldown" : "An extra-tasty meal",
        action: { kind: "use", itemId, care, availability },
      };
    });
  const held = Object.values(shop.inventory).reduce<number>((total, count) => total + (count ?? 0), 0);
  return {
    id: "pack",
    label: "Pack",
    ...(held > 0 ? { badge: held } : {}),
    groups: [{ id: "pack", rows }],
    empty: "Nothing in your pack yet — buy food or medicine and it waits here until you need it.",
  };
};

const foodTab = (shop: ShopModel): ShopTab => ({
  id: "food",
  label: "Food",
  groups: [
    {
      id: "food",
      rows: [
        ...Object.entries(shop.catalog.food).map(([itemId, item]) =>
          buyRow(
            itemId,
            item,
            `Feeds ×${(item.scalePercent / 100).toFixed(2)} · +${item.joyBonus / 10_000}% joy`,
            shop,
            "🍖",
          ),
        ),
        ...Object.entries(shop.catalog.medicine).map(([itemId, item]) =>
          buyRow(itemId, item, "Cures instantly, no cooldown", shop, "💊"),
        ),
      ],
    },
  ],
});

const toysTab = (shop: ShopModel): ShopTab => ({
  id: "toys",
  label: "Toys",
  groups: [
    {
      id: "toys",
      rows: Object.entries(shop.catalog.toys).map(([itemId, item]) => {
        const row = buyRow(itemId, item, `Play restores +${item.playBonusPercent}% more`, shop, "🎮");
        return shop.toys.includes(itemId) ? badgeRow(row, "Owned", "Installed for this generation") : row;
      }),
    },
  ],
});

const styleTab = (shop: ShopModel): ShopTab => ({
  id: "style",
  label: "Style",
  groups: [
    {
      id: "cosmetics",
      rows: Object.entries(shop.catalog.cosmetics).map(([itemId, item]): ShopRow => {
        const row = buyRow(itemId, item, "Worn by Makoto, kept forever", shop, "🎀");
        if (!shop.room.cosmetics.includes(itemId)) return row;
        return shop.room.activeCosmetic === itemId
          ? { ...row, detail: "Makoto is wearing this", action: { kind: "wear", itemId: null, label: "Take Off" } }
          : { ...row, detail: "Yours, kept forever", action: { kind: "wear", itemId, label: "Wear" } };
      }),
    },
  ],
});

/**
 * Everything the whole room sees, in three groups by what it changes: the
 * things standing in it, the walls around it, and the places it goes.
 */
const roomTab = (shop: ShopModel): ShopTab => {
  const grand = Object.entries(shop.catalog.grand);

  const decorations: ShopRow[] = [
    ...Object.entries(shop.catalog.decor).map(([itemId, item]) => {
      const row = buyRow(itemId, item, "Stays in the room for good", shop, "🪴");
      return shop.room.decor.includes(itemId) ? badgeRow(row, "Placed", "Standing in the room") : row;
    }),
    ...grand
      .filter(([, item]) => item.group === "decor")
      .map(([itemId, item]) =>
        grandRow(itemId, item.label, shop, "🪑", {
          open: "Everyone chips in — then it's in the room",
          funded: "Everyone paid for this one",
          fundedBadge: "Placed",
        }),
      ),
  ];

  // Every style the room could wear, one row each, default first. A funded
  // style keeps its row and trades its pool for a switcher (SPEC §22.5).
  const styleRow = (themeId: string, itemId: string | null, name: string): ShopRow => {
    const identity = { id: `theme-${themeId}`, icon: icon(itemId ?? "", "🎨"), name };
    if (shop.room.activeTheme === themeId) {
      return { ...identity, detail: "The room is wearing this", action: { kind: "badge", label: "In Use" } };
    }
    if (shop.room.themes.includes(themeId)) {
      return { ...identity, detail: "Owned by the room", action: { kind: "theme", themeId } };
    }
    // Not owned yet, so the row is its pool. It keeps the same id either way,
    // so switching a style on is the same row it was funded through.
    return {
      ...grandRow(itemId ?? themeId, name, shop, "🎨", {
        open: "Repaints the room for everyone",
        funded: "Owned by the room",
        fundedBadge: "Owned",
      }),
      id: identity.id,
    };
  };

  // A style the room owns but nobody had to fund is one that shipped free —
  // no constant to keep in step with the server's DEFAULT_THEME, just the two
  // lists compared.
  const sold = grand.flatMap(([itemId, item]) => {
    const themeId = themeIdOf(item);
    return themeId === null ? [] : [{ itemId, themeId, label: item.label }];
  });
  const soldIds = new Set(sold.map((style) => style.themeId));
  const styles: ShopRow[] = [
    ...shop.room.themes
      .filter((themeId) => !soldIds.has(themeId))
      .map((themeId) => styleRow(themeId, null, THEMES[themeId]?.label ?? themeId)),
    ...sold.map((style) => styleRow(style.themeId, style.itemId, style.label)),
  ];

  const places: ShopRow[] = grand
    .filter(([, item]) => item.group === "venue")
    .map(([itemId, item]) =>
      grandRow(itemId, item.label, shop, "🧭", {
        open: "A place Makoto could spend the day",
        funded: "Makoto spends some days here",
        fundedBadge: "In Rotation",
      }),
    );

  const groups: ShopGroup[] = [
    { id: "decorations", heading: "Decorations", rows: decorations },
    { id: "styles", heading: "Wall Styles", rows: styles },
    { id: "places", heading: "Places to Visit", rows: places },
  ];
  const coop = groups.some((group) => group.rows.some((row) => row.action.kind === "fund"));
  return {
    id: "room",
    label: "Room",
    groups,
    ...(coop ? { footnote: "Everyone can chip in. Contributions are shared and non-refundable." } : {}),
  };
};

/** Every section reads its display name from the catalog — one source. */
export const itemLabel = (shopCatalog: ShopCatalog, itemId: string): string => {
  const sections = [
    shopCatalog.food,
    shopCatalog.medicine,
    shopCatalog.toys,
    shopCatalog.cosmetics,
    shopCatalog.decor,
    shopCatalog.grand,
  ] as Record<string, { label: string }>[];
  return sections.map((section) => section[itemId]?.label).find((label) => label !== undefined) ?? itemId;
};

export const shopTabs = (shop: ShopModel, gate: CareGate): ShopTab[] => [
  packTab(shop, gate),
  foodTab(shop),
  toysTab(shop),
  styleTab(shop),
  roomTab(shop),
];

/** Where the shop opens: on your pack when there is something in it. */
export const initialTab = (tabs: readonly ShopTab[]): TabId =>
  tabs.find((tab) => tab.id === "pack")?.groups.some((group) => group.rows.length > 0) ? "pack" : "food";
