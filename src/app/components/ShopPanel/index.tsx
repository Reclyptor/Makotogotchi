"use client";

// The shop (SPEC §13.2): spend coins earned by caring. Consumables land in
// your pack (use them from here), toys install for the generation, and
// cosmetics/decor change the room everyone sees.
//
// Layout discipline: every item renders through ONE row component — name
// over a muted detail line on the left, a fixed-width action slot on the
// right — so labels, prices, and badges align across all sections.

import { useCallback, useEffect, useState } from "react";
import { THEMES } from "@/game/scene/backdrop";
import type { RoomView } from "@/server/shop";

type Catalog = {
  food: Record<string, { label: string; price: number; scalePercent: number; joyBonus: number }>;
  medicine: Record<string, { label: string; price: number }>;
  toys: Record<string, { label: string; price: number; playBonusPercent: number }>;
  cosmetics: Record<string, { label: string; price: number }>;
  decor: Record<string, { label: string; price: number }>;
  grand: Record<string, { label: string; price: number }>;
};

/** A grand item's pool (SPEC §21.8) — communal, never one person's. */
type Funding = { itemId: string; label: string; price: number; pooled: number; funded: boolean };

type ShopState = {
  catalog: Catalog;
  coins: number;
  inventory: Partial<Record<string, number>>;
  room: RoomView;
  toys: string[];
  funding: Funding[];
};

/** Every section reads its display name from the catalog — one source. */
const itemLabel = (shop: ShopState | null, itemId: string): string => {
  if (!shop) return itemId;
  const sections = [
    shop.catalog.food,
    shop.catalog.medicine,
    shop.catalog.toys,
    shop.catalog.cosmetics,
    shop.catalog.decor,
    shop.catalog.grand,
  ];
  return sections.map((section) => section[itemId]?.label).find((label) => label !== undefined) ?? itemId;
};

export type ShopPanelProps = {
  onClose: () => void;
};

/** The one row shape every section uses — this is what keeps the shop tidy. */
type RowProps = {
  name: string;
  detail: React.ReactNode;
  action: React.ReactNode;
};

const Row = ({ name, detail, action }: RowProps) => (
  <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04]">
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold leading-tight">{name}</p>
      <p className="truncate text-[11px] leading-tight text-muted">{detail}</p>
    </div>
    <div className="flex w-24 justify-end">{action}</div>
  </li>
);

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted first:pt-0">
    {children}
  </h3>
);

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-semibold text-mint">{children}</span>
);

export default function ShopPanel({ onClose }: ShopPanelProps) {
  const [shop, setShop] = useState<ShopState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/shop").catch(() => null);
    if (response?.ok) setShop((await response.json()) as ShopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/shop")
      .then(async (response) => {
        if (response.ok && !cancelled) setShop((await response.json()) as ShopState);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  const buy = async (itemId: string): Promise<void> => {
    setNotice(null);
    const response = await fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buy: itemId }),
    }).catch(() => null);
    if (!response) return;
    if (response.ok) {
      setNotice(`Bought ${itemLabel(shop, itemId)}!`);
    } else {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(
        body?.error === "INSUFFICIENT_COINS"
          ? "Not enough coins — care for Makoto to earn more."
          : body?.error === "ALREADY_OWNED"
            ? "Already owned."
            : "Couldn't buy that.",
      );
    }
    await refresh();
  };

  const consumeOwnedItem = async (itemId: string, action: "FEED" | "MEDICATE"): Promise<void> => {
    setNotice(null);
    const response = await fetch("/api/care", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, itemId }),
    }).catch(() => null);
    if (!response) return;
    if (response.ok) setNotice("Used it — look at the room!");
    else {
      const body = (await response.json().catch(() => null)) as { reason?: string } | null;
      setNotice(body?.reason === "NO_ITEM" ? "None left." : `Makoto can't right now (${body?.reason ?? "busy"}).`);
    }
    await refresh();
  };

  const chipIn = async (itemId: string, amount: 10 | 50): Promise<void> => {
    setNotice(null);
    const response = await fetch("/api/shop/contribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, amount }),
    }).catch(() => null);
    if (!response) return;
    if (response.ok) {
      const body = (await response.json()) as { funded: boolean; spent: number };
      setNotice(body.funded ? "Funded! Look at the room." : `Chipped in ${body.spent} 🪙.`);
    } else {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(
        body?.error === "INSUFFICIENT_COINS"
          ? "Not enough coins — care for Makoto to earn more."
          : body?.error === "ALREADY_FUNDED"
            ? "Already funded."
            : "Couldn't chip in.",
      );
    }
    await refresh();
  };

  const wear = async (itemId: string | null): Promise<void> => {
    await fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wear: itemId }),
    }).catch(() => null);
    await refresh();
  };

  // Changing the room's style changes it for everyone (SPEC §22.5).
  const switchTheme = async (themeId: string): Promise<void> => {
    await fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeId }),
    }).catch(() => null);
    setNotice("The room changes for everyone.");
    await refresh();
  };

  const priceButton = (itemId: string, price: number) => (
    <button
      type="button"
      onClick={() => void buy(itemId)}
      aria-label={`Buy ${itemLabel(shop, itemId)} for ${price} coins`}
      className="press w-full rounded-lg bg-accent-strong px-2 py-1.5 text-center text-xs font-bold tabular-nums text-white"
    >
      🪙 {price}
    </button>
  );

  const smallButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="press w-full rounded-lg bg-white/10 px-2 py-1.5 text-center text-xs font-semibold hover:bg-accent/25"
    >
      {label}
    </button>
  );

  if (!shop) {
    return (
      <section aria-label="Shop" className="panel w-full p-4 text-sm text-muted">
        Opening the shop…
      </section>
    );
  }

  return (
    <section aria-label="Shop" className="panel animate-pop flex w-full flex-col gap-1 p-4">
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-sm font-bold">🛒 Shop</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gold/15 px-3 py-1 text-sm font-bold tabular-nums text-gold">🪙 {shop.coins}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shop"
            className="press rounded-full bg-white/10 px-3 py-1 text-xs font-semibold"
          >
            ✕
          </button>
        </div>
      </div>

      <ul className="flex flex-col">
        {Object.entries(shop.inventory).some(([, count]) => (count ?? 0) > 0) && (
          <>
            <SectionHeading>Your Pack</SectionHeading>
            {Object.entries(shop.inventory)
              .filter(([, count]) => (count ?? 0) > 0)
              .map(([itemId, count]) => (
                <Row
                  key={`pack-${itemId}`}
                  name={`${itemLabel(shop, itemId)} ×${count}`}
                  detail={itemId in shop.catalog.medicine ? "Cures instantly, no cooldown" : "Extra-tasty meal"}
                  action={smallButton("Use", () => void consumeOwnedItem(itemId, itemId in shop.catalog.medicine ? "MEDICATE" : "FEED"))}
                />
              ))}
          </>
        )}

        <SectionHeading>Food &amp; Medicine</SectionHeading>
        {Object.entries(shop.catalog.food).map(([itemId, item]) => (
          <Row
            key={itemId}
            name={item.label}
            detail={`Feeds ×${(item.scalePercent / 100).toFixed(2)} · +${item.joyBonus / 10_000}% joy`}
            action={priceButton(itemId, item.price)}
          />
        ))}
        {Object.entries(shop.catalog.medicine).map(([itemId, item]) => (
          <Row key={itemId} name={item.label} detail="Cures instantly, no cooldown" action={priceButton(itemId, item.price)} />
        ))}

        <SectionHeading>Toys · This Generation</SectionHeading>
        {Object.entries(shop.catalog.toys).map(([itemId, item]) => (
          <Row
            key={itemId}
            name={item.label}
            detail={`Play restores +${item.playBonusPercent}% more`}
            action={shop.toys.includes(itemId) ? <Badge>Owned</Badge> : priceButton(itemId, item.price)}
          />
        ))}

        <SectionHeading>Room &amp; Style · Everyone Sees</SectionHeading>
        {Object.entries(shop.catalog.decor).map(([itemId, item]) => (
          <Row
            key={itemId}
            name={item.label}
            detail="Permanent room decoration"
            action={shop.room.decor.includes(itemId) ? <Badge>Placed</Badge> : priceButton(itemId, item.price)}
          />
        ))}
        <SectionHeading>Room Style · Everyone Sees</SectionHeading>
        {shop.room.themes.map((themeId) => (
          <Row
            key={themeId}
            name={THEMES[themeId]?.label ?? themeId}
            detail={themeId === shop.room.activeTheme ? "In use now" : "Owned by the room"}
            action={
              themeId === shop.room.activeTheme ? (
                <Badge>In Use</Badge>
              ) : (
                smallButton("Use", () => void switchTheme(themeId))
              )
            }
          />
        ))}

        <SectionHeading>Together · Funded by Everyone</SectionHeading>
        {shop.funding.map((pool) => (
          <Row
            key={pool.itemId}
            name={pool.label}
            detail={
              pool.funded ? (
                "In the room, funded by everyone"
              ) : (
                <>
                  <span className="tabular-nums">
                    {pool.pooled}/{pool.price} 🪙
                  </span>
                  <span
                    aria-hidden="true"
                    className="ml-2 inline-block h-1 w-16 max-w-full align-middle overflow-hidden rounded-full bg-white/10"
                  >
                    <span
                      className="block h-full rounded-full bg-gold transition-[width] duration-500 ease-out"
                      style={{ width: `${(pool.pooled / pool.price) * 100}%` }}
                    />
                  </span>
                </>
              )
            }
            action={
              pool.funded ? (
                <Badge>Placed</Badge>
              ) : (
                <span className="flex w-full gap-1">
                  {([10, 50] as const).map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => void chipIn(pool.itemId, amount)}
                      aria-label={`Chip in ${amount} coins toward ${pool.label}`}
                      className="press w-full rounded-lg bg-accent-strong px-1 py-1.5 text-center text-xs font-bold tabular-nums text-white"
                    >
                      +{amount}
                    </button>
                  ))}
                </span>
              )
            }
          />
        ))}
        <li className="px-2.5 pb-1 text-[11px] leading-tight text-muted">Contributions are shared and non-refundable.</li>

        {Object.entries(shop.catalog.cosmetics).map(([itemId, item]) => {
          const owned = shop.room.cosmetics.includes(itemId);
          const active = shop.room.activeCosmetic === itemId;
          return (
            <Row
              key={itemId}
              name={item.label}
              detail={active ? "Makoto is wearing this" : "Wearable, kept forever"}
              action={
                !owned
                  ? priceButton(itemId, item.price)
                  : active
                    ? smallButton("Take Off", () => void wear(null))
                    : smallButton("Wear", () => void wear(itemId))
              }
            />
          );
        })}
      </ul>

      {notice && (
        <p aria-live="polite" className="px-2.5 pt-2 text-xs text-muted">
          {notice}
        </p>
      )}
    </section>
  );
}
