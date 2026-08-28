"use client";

// The shop (SPEC §13.2): spend coins earned by caring, one category at a
// time, in a dialog over the game rather than a column shoved into it.
//
// This file is the shell and nothing else — chrome, tabs, and the notice.
// What is for sale and whether you may have it is decided in tabs.ts; how a
// row draws is rows.tsx; who to ask for it is useShop.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Row, type RowHandlers } from "./rows";
import { initialTab, shopTabs, type ShopTab, type TabId } from "./tabs";
import { useShop } from "./useShop";
import type { PetState, ProjectionContext } from "@/sim/model";
import type { RoomView } from "@/server/shop";
import type { Purse } from "@/server/purse";

export type ShopPanelProps = {
  state: PetState;
  ctx: ProjectionContext;
  caretakerId: string;
  petName: string;
  /** The room as the canvas has it — the shop never fetches its own copy. */
  room: RoomView;
  /** Balance and pack, live off the stream (SPEC §13.1) — likewise not fetched. */
  purse: Purse;
  /** A pool completing elsewhere is the one shop change the stream reports. */
  onFunded: (listener: () => void) => () => void;
  /** Today on the pet's calendar — the ballot the room can still move is
   *  tomorrow's (SPEC §22.9). Passed in rather than read here, because
   *  reading a clock during render is impure. */
  petDay: number | null;
  onClose: () => void;
};

const TAB_ORDER: TabId[] = ["pack", "food", "toys", "style", "room"];

export default function ShopPanel({ state, ctx, caretakerId, petName, room, purse, onFunded, petDay, onClose }: ShopPanelProps) {
  const shop = useShop(petName, onFunded);
  const [active, setActive] = useState<TabId | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  const tabs: ShopTab[] | null = useMemo(() => {
    if (!shop.data) return null;
    return shopTabs(
      {
        catalog: shop.data.catalog,
        coins: purse.coins,
        inventory: purse.inventory,
        room,
        toys: state.toys,
        funding: shop.data.funding,
        petDay,
      },
      { state, ctx, caretakerId, petName },
    );
  }, [shop.data, purse, room, state, ctx, caretakerId, petName, petDay]);

  // Escape closes, and focus goes back where it came from. Both are the
  // dialog's job, not the opener's — nothing else on the page can know that
  // this is the thing on top.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const { body } = document;
    const scroll = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = scroll;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handlers: RowHandlers = useMemo(
    () => ({
      buy: (itemId, label) => void shop.buy(itemId, label),
      use: (itemId, care) => void shop.use(itemId, care),
      chipIn: (itemId, amount) => void shop.chipIn(itemId, amount),
      vote: (venueId, tickets) => void shop.vote(venueId, tickets),
      wear: (itemId) => void shop.wear(itemId),
      switchTheme: (themeId) => void shop.switchTheme(themeId),
    }),
    [shop],
  );

  // Left/right walk the tabs, as a tablist is expected to (SPEC §11.3).
  const step = useCallback(
    (from: TabId, delta: number): void => {
      const next = TAB_ORDER[(TAB_ORDER.indexOf(from) + delta + TAB_ORDER.length) % TAB_ORDER.length];
      if (next === undefined) return;
      setActive(next);
      dialogRef.current?.querySelector<HTMLButtonElement>(`#shop-tab-${next}`)?.focus();
    },
    [],
  );

  const current = tabs?.find((tab) => tab.id === (active ?? initialTab(tabs))) ?? null;

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* A sheet on a phone, a centred card from sm: up. As a sheet it ends at
          the bottom of the screen, where the home indicator lives, so the last
          row is held clear of it by the safe area. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shop"
        tabIndex={-1}
        className="panel animate-rise flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden !rounded-b-none !rounded-t-3xl pb-[env(safe-area-inset-bottom)] outline-none sm:max-h-[80dvh] sm:!rounded-3xl sm:pb-0"
      >
        <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <h2 className="text-sm font-bold">🛒 Shop</h2>
          <div className="flex items-center gap-2">
            <span
              aria-label={`${purse.coins} coins`}
              className="rounded-full bg-gold/15 px-3 py-1 text-sm font-bold tabular-nums text-gold"
            >
              <span aria-hidden="true">🪙 </span>
              {purse.coins}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close shop"
              className="press rounded-full bg-white/10 px-3 py-1 text-xs font-semibold"
            >
              ✕
            </button>
          </div>
        </header>

        {tabs === null || current === null ? (
          <p className="px-4 pb-5 pt-2 text-sm text-muted">Opening the shop…</p>
        ) : (
          <>
            <div role="tablist" aria-label="Shop categories" className="flex gap-1 overflow-x-auto px-3 pb-2">
              {tabs.map((tab) => {
                const selected = tab.id === current.id;
                return (
                  <button
                    key={tab.id}
                    id={`shop-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="shop-tabpanel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowRight") step(current.id, 1);
                      if (event.key === "ArrowLeft") step(current.id, -1);
                    }}
                    className={`press shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                      selected ? "bg-accent-strong text-white" : "bg-white/[0.07] text-muted hover:bg-white/15"
                    }`}
                  >
                    {tab.label}
                    {tab.badge !== undefined && (
                      <span className="ml-1.5 tabular-nums text-[10px] opacity-80">{tab.badge}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div
              id="shop-tabpanel"
              role="tabpanel"
              aria-labelledby={`shop-tab-${current.id}`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2"
            >
              {current.groups.every((group) => group.rows.length === 0) ? (
                <p className="px-3 py-6 text-center text-sm text-muted">{current.empty}</p>
              ) : (
                current.groups
                  .filter((group) => group.rows.length > 0)
                  .map((group) => (
                    <section key={group.id} aria-label={group.heading}>
                      {group.heading && (
                        <h3 className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                          {group.heading}
                        </h3>
                      )}
                      <ul className="flex flex-col">
                        {group.rows.map((row) => (
                          <Row key={row.id} row={row} on={handlers} />
                        ))}
                      </ul>
                    </section>
                  ))
              )}
              {current.footnote && <p className="px-3 pb-2 pt-3 text-[11px] leading-tight text-muted">{current.footnote}</p>}
            </div>
          </>
        )}

        {/* The result of the last thing you did, where you can still see it.
            Always mounted so the live region is there to announce into, but it
            takes no room until it has something to say. */}
        <p
          aria-live="polite"
          className={`shrink-0 px-4 text-xs text-muted ${shop.notice ? "border-t border-white/10 py-2.5" : ""}`}
        >
          {shop.notice}
        </p>
      </div>
    </div>
  );
}
