"use client";

// The shop (SPEC §13.2): spend coins earned by caring. Consumables land in
// your pack (use them from here), toys install for the generation, and
// cosmetics/decor change the room everyone sees.

import { useCallback, useEffect, useState } from "react";

type Catalog = {
  food: Record<string, { price: number; scalePercent: number; joyBonus: number }>;
  medicine: Record<string, { price: number }>;
  toys: Record<string, { price: number; playBonusPercent: number }>;
  cosmetics: Record<string, { price: number; label: string }>;
  decor: Record<string, { price: number; label: string }>;
};

type ShopState = {
  catalog: Catalog;
  coins: number;
  inventory: Partial<Record<string, number>>;
  room: { cosmetics: string[]; activeCosmetic: string | null; decor: string[] };
  toys: string[];
};

const ITEM_LABELS: Record<string, string> = {
  pepper_treat: "Pepper Treat",
  fish_feast: "Fish Feast",
  super_medicine: "Super Medicine",
  teeter: "Teeter Toy",
  wheel: "Running Wheel",
};

export type ShopPanelProps = {
  onClose: () => void;
};

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
      setNotice(`Bought ${ITEM_LABELS[itemId] ?? itemId}!`);
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

  const wear = async (itemId: string | null): Promise<void> => {
    await fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wear: itemId }),
    }).catch(() => null);
    await refresh();
  };

  if (!shop) {
    return (
      <section aria-label="Shop" className="panel w-full p-4 text-sm text-muted">
        Opening the shop…
      </section>
    );
  }

  const row = (itemId: string, price: number, detail: string, owned: boolean, onBuy?: () => void): React.ReactElement => (
    <li key={itemId} className="flex items-center justify-between gap-2 text-sm">
      <span>
        {ITEM_LABELS[itemId] ?? itemId}
        <span className="ml-2 text-xs text-muted">{detail}</span>
      </span>
      {owned ? (
        <span className="text-xs text-emerald-400">owned</span>
      ) : (
        <button
          type="button"
          onClick={onBuy ?? (() => void buy(itemId))}
          className="press rounded-md bg-accent-strong/80 px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110"
        >
          🪙 {price}
        </button>
      )}
    </li>
  );

  return (
    <section aria-label="Shop" className="panel animate-pop flex w-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">🛒 Shop</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums">🪙 {shop.coins}</span>
          <button type="button" onClick={onClose} className="text-sm text-muted underline underline-offset-2">
            close
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted">Pack</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {Object.entries(shop.inventory)
              .filter(([, count]) => (count ?? 0) > 0)
              .map(([itemId, count]) => (
                <li key={itemId} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {ITEM_LABELS[itemId] ?? itemId} ×{count}
                  </span>
                  <button
                    type="button"
                    onClick={() => void consumeOwnedItem(itemId, itemId in shop.catalog.medicine ? "MEDICATE" : "FEED")}
                    className="press rounded-md bg-white/10 px-2.5 py-1 text-xs hover:bg-accent/30"
                  >
                    use
                  </button>
                </li>
              ))}
            {Object.values(shop.inventory).every((count) => !count) && (
              <li className="text-xs text-muted">Empty — buy food or medicine below.</li>
            )}
          </ul>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted">Food &amp; Medicine</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {Object.entries(shop.catalog.food).map(([itemId, item]) =>
              row(itemId, item.price, `feeds ×${(item.scalePercent / 100).toFixed(2)} +joy`, false),
            )}
            {Object.entries(shop.catalog.medicine).map(([itemId, item]) => row(itemId, item.price, "instant cure", false))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted">Toys (this generation)</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {Object.entries(shop.catalog.toys).map(([itemId, item]) =>
              row(itemId, item.price, `play +${item.playBonusPercent}%`, shop.toys.includes(itemId)),
            )}
          </ul>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted">Room &amp; Style (everyone sees)</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {Object.entries(shop.catalog.decor).map(([itemId, item]) =>
              row(itemId, item.price, item.label, shop.room.decor.includes(itemId)),
            )}
            {Object.entries(shop.catalog.cosmetics).map(([itemId, item]) => {
              const owned = shop.room.cosmetics.includes(itemId);
              const active = shop.room.activeCosmetic === itemId;
              return (
                <li key={itemId} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {item.label}
                    {active && <span className="ml-2 text-xs text-emerald-400">wearing</span>}
                  </span>
                  {owned ? (
                    active ? (
                      <button type="button" onClick={() => void wear(null)} className="press rounded-md bg-white/10 px-2.5 py-1 text-xs">
                        take off
                      </button>
                    ) : (
                      <button type="button" onClick={() => void wear(itemId)} className="press rounded-md bg-white/10 px-2.5 py-1 text-xs">
                        wear
                      </button>
                    )
                  ) : (
                    <button type="button" onClick={() => void buy(itemId)} className="press rounded-md bg-accent-strong/80 px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110">
                      🪙 {item.price}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {notice && (
        <p aria-live="polite" className="text-xs text-muted">
          {notice}
        </p>
      )}
    </section>
  );
}
