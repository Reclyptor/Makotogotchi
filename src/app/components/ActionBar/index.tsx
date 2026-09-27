"use client";

// The care actions (SPEC §11.2) as tactile tiles: springy press feedback, a
// draining progress track while a cooldown runs, and the reason always
// visible. Availability comes from the same canPerform() the server
// enforces — the single authority (SPEC §4.1). aria-disabled (never
// disabled) keeps unavailable actions in the tab order with their reason in
// the accessible name (SPEC §11.3).
//
// Feed is a split tile. Its face serves the free meal in one tap, as it
// always did; a chevron beside it opens the pack — every food and drink this
// caretaker owns, each with its line and its own availability — and a way
// into the shop when the pack is empty. Choosing a meal used to mean opening
// the shop, finding the Pack tab and using it from there, which nobody did;
// a menu belongs on the tile that feeds.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { canPerform } from "@/sim/validate";
import { zeroApplyReason, type ZeroApplyReason } from "@/sim/score";
import { CARE_ACTIONS, TICK_SECONDS, type CareAction } from "@/sim/tuning";
import { DRINK_ITEMS, FOOD_ITEMS } from "@/sim/economy";
import type { PetState, ProjectionContext } from "@/sim/model";
import { packEntry, type PackEntry } from "@/app/copy/items";
import { isLockReason, REASON_GLYPH, REASON_SHORT, rejectionText, zeroApplyText, ZERO_APPLY_GLYPH, ZERO_APPLY_SHORT } from "./copy";

const ACTION_META: Record<CareAction, { label: string; emoji: string }> = {
  FEED: { label: "Feed", emoji: "🍖" },
  PLAY: { label: "Play", emoji: "🎮" },
  CLEAN: { label: "Clean", emoji: "🌪️" },
  MEDICATE: { label: "Medicate", emoji: "💊" },
  LULLABY: { label: "Lullaby", emoji: "🎵" },
  PET: { label: "Pet", emoji: "💛" },
};

/** Catalog order, so the chooser lists the pack the way the shop does. */
const FEEDABLE_IDS = [...Object.keys(FOOD_ITEMS), ...Object.keys(DRINK_ITEMS)];

/**
 * How far a cooldown has left to run, 1 just after the action to 0 when it is
 * ready again. The sim's tick is a whole number that only moves every ten
 * seconds, so a bar driven by it lurches; this measures the remainder in
 * fractional ticks against the corrected clock, which drains smoothly between
 * ticks (SPEC §11.2).
 *
 * The span is the whole window the action is held for — armed to ready — not
 * the nominal length of one of the two overlapping cooldowns. Measuring
 * against a cooldown that ends before the action frees up is what made the
 * bar empty and then refill.
 */
export const cooldownProgress = (sinceTick: number, readyAtTick: number, nowTickExact: number): number => {
  const span = readyAtTick - sinceTick;
  if (span <= 0) return 0;
  const remaining = Math.max(0, readyAtTick - nowTickExact);
  return Math.min(1, remaining / span);
};

/** Whole seconds still to wait, for the label under the button. */
export const cooldownSeconds = (retryAtTick: number, nowTickExact: number): number =>
  Math.max(1, Math.ceil(Math.max(0, retryAtTick - nowTickExact) * TICK_SECONDS));

export type ActionBarProps = {
  state: PetState;
  ctx: ProjectionContext;
  caretakerId: string;
  petName: string;
  /**
   * The corrected clock in fractional ticks, sampled at the caller's last
   * projection. It arrives as a prop so this component stays pure across
   * renders, so the bars move on the same 250ms cadence the meters do, and so
   * a bar empties on exactly the tick canPerform() starts saying yes.
   */
  nowTickExact: number;
  /** This caretaker's pack, live off the stream (SPEC §13.1) — what Feed can offer besides the free meal. */
  pack: Partial<Record<string, number>>;
  /** PLAY launches the minigame (SPEC §13.3) instead of posting directly. */
  onPlay: () => void;
  /** Opens the shop on its Food tab, for a pack with nothing in it. */
  onShop: () => void;
};

type Tile = {
  action: CareAction;
  ok: boolean;
  outlook: ZeroApplyReason | null;
  hint: string | null;
  label: string | null;
  glyph: string | undefined;
  cooldownFraction: number;
};

export default function ActionBar({ state, ctx, caretakerId, petName, nowTickExact, pack, onPlay, onShop }: ActionBarProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserId = useId();
  const chooserRef = useRef<HTMLDivElement | null>(null);
  const chevronRef = useRef<HTMLButtonElement | null>(null);

  // `outlook` is read off the same state the tile rendered from, before the
  // action moves it: an applied-nothing result has to be explained by the
  // world as it was when the button was pressed, not as it is afterwards.
  const act = useCallback(
    async (action: CareAction, outlook: ZeroApplyReason | null, item?: PackEntry) => {
      setNotice(null);
      const response = await fetch("/api/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(item ? { itemId: item.itemId } : {}) }),
      }).catch(() => null);
      if (!response) {
        setNotice("Connection hiccup — try again.");
        return;
      }
      if (response.status === 429) {
        setNotice("Easy! You're moving too fast.");
      } else if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null;
        const reason = body?.reason;
        setNotice(isLockReason(reason) ? `${rejectionText(petName)[reason]}.` : `${petName} can't do that right now.`);
      } else if (response.ok) {
        const body = (await response.json().catch(() => null)) as { applied?: number; itemKept?: boolean } | null;
        if (item && body?.itemKept) {
          // The sim moved nothing, so the server handed the item back (SPEC §13.2).
          setNotice(`${petName} didn't need that — the ${item.label} is still in your pack.`);
        } else if (body && body.applied === 0 && !item) {
          setNotice(outlook ? zeroApplyText(petName, action, outlook) : `${petName} didn't need that just now.`);
        }
      }
    },
    [petName],
  );

  const reasons = rejectionText(petName);

  const tiles: Tile[] = CARE_ACTIONS.map((action) => {
    const verdict = canPerform(state, action, caretakerId, ctx);
    // Allowed is not the same as worth doing. An action whose need is
    // full, or whose weekly allowance is spent, still passes every gate
    // and still costs a cooldown — so it says so on the tile rather than
    // only in the notice that follows the press.
    const outlook = verdict.ok ? zeroApplyReason(state, action, caretakerId, state.tick) : null;
    // Two registers for one reason: the sentence goes in the accessible
    // name and the tooltip, the short form on the tile itself, which is
    // too narrow for a sentence and used to truncate mid-word.
    let hint: string | null = null;
    let label: string | null = null;
    let glyph: string | undefined;
    let cooldownFraction = 0; // 0 = ready, 1 = just used
    if (!verdict.ok) {
      hint = reasons[verdict.reason];
      label = REASON_SHORT[verdict.reason];
      if (verdict.retryAtTick !== undefined && verdict.sinceTick !== undefined) {
        cooldownFraction = cooldownProgress(verdict.sinceTick, verdict.retryAtTick, nowTickExact);
        const seconds = cooldownSeconds(verdict.retryAtTick, nowTickExact);
        hint = `${hint} (${seconds}s)`;
        label = `${label} ${seconds}s`;
      } else {
        glyph = REASON_GLYPH[verdict.reason];
      }
    } else if (outlook) {
      hint = zeroApplyText(petName, action, outlook);
      label = ZERO_APPLY_SHORT[outlook];
      glyph = ZERO_APPLY_GLYPH[outlook];
    }
    return { action, ok: verdict.ok, outlook, hint, label, glyph, cooldownFraction };
  });
  const feed = tiles.find((tile) => tile.action === "FEED")!;

  // The pack, in catalog order, each entry judged the way the shop judges it
  // (SPEC §13.2): a drink is offered during a nap, a meal is not.
  const entries = FEEDABLE_IDS.flatMap((itemId) => {
    const count = pack[itemId] ?? 0;
    const entry = count > 0 ? packEntry(itemId) : null;
    if (!entry) return [];
    const verdict = canPerform(state, "FEED", caretakerId, ctx, itemId);
    return [{ entry, count, ok: verdict.ok, note: verdict.ok ? null : reasons[verdict.reason] }];
  });

  // The chooser is a menu: Escape and a click elsewhere close it, arrows walk
  // it, and closing hands focus back to the chevron that opened it.
  useEffect(() => {
    if (!chooserOpen) return;
    chooserRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setChooserOpen(false);
        chevronRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (chooserRef.current?.contains(target) || chevronRef.current?.contains(target)) return;
      setChooserOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [chooserOpen]);

  const walkMenu = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(chooserRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  };

  const choose = (run: () => void): void => {
    setChooserOpen(false);
    chevronRef.current?.focus();
    run();
  };

  const face = (tile: Tile): React.ReactNode => {
    const meta = ACTION_META[tile.action];
    return (
      <>
        {/* The reason marks the tile it belongs to; it is already in the
            accessible name, so this is decoration for sighted players. */}
        {tile.glyph && (
          <span aria-hidden="true" className="absolute right-1 top-1 text-[11px] leading-none">
            {tile.glyph}
          </span>
        )}
        {/* A locked tile fades its icon and *sharpens* its reason. Fading
            the whole tile uniformly, as this did at 45%, made the one
            line that explains the lock the hardest thing on it to read. */}
        <span
          aria-hidden="true"
          className={`text-xl leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] ${tile.ok ? "" : "opacity-50 grayscale"}`}
        >
          {meta.emoji}
        </span>
        <span className={`text-[12px] font-semibold leading-tight ${tile.ok ? "" : "text-muted"}`}>{meta.label}</span>
        <span className={`min-h-3.5 max-w-full truncate px-1 text-[10px] leading-tight ${tile.label ? "text-foreground/85" : "text-muted"}`}>
          {tile.label ?? " "}
        </span>
        {/* Cooldown drain track along the bottom edge. */}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
          <span
            className="block h-full rounded-r-full bg-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${tile.cooldownFraction * 100}%` }}
          />
        </span>
      </>
    );
  };

  const tileButton = (tile: Tile, className: string, onClick: () => void): React.ReactNode => {
    const meta = ACTION_META[tile.action];
    return (
      <button
        type="button"
        onClick={() => {
          if (tile.ok) onClick();
        }}
        aria-disabled={!tile.ok}
        aria-label={tile.hint ? `${meta.label} — ${tile.hint}` : meta.label}
        title={tile.hint ?? meta.label}
        className={`press relative flex min-h-16 flex-col items-center justify-center gap-0.5 overflow-hidden px-1 py-2 text-sm ${className} ${
          tile.ok ? "hover:border-accent/40 hover:shadow-[0_0_18px_-6px_var(--color-accent)]" : "cursor-not-allowed opacity-70"
        }`}
      >
        {face(tile)}
      </button>
    );
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div role="group" aria-label="Care actions" className="grid w-full grid-cols-3 gap-2 sm:grid-cols-6">
        {tiles.map((tile) =>
          tile.action === "FEED" ? (
            <div key={tile.action} className="panel relative flex overflow-hidden !rounded-xl">
              {tileButton(tile, "flex-1", () => void act(tile.action, tile.outlook))}
              {/* Never locked with the face: a drink is offered mid-nap when the meal is not. */}
              <button
                ref={chevronRef}
                type="button"
                aria-label="Choose a meal"
                aria-haspopup="menu"
                aria-expanded={chooserOpen}
                aria-controls={chooserId}
                onClick={() => setChooserOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && !chooserOpen) {
                    event.preventDefault();
                    setChooserOpen(true);
                  }
                }}
                className="press flex w-7 shrink-0 items-center justify-center border-l border-white/10 text-xs text-muted hover:bg-white/5 hover:text-foreground"
              >
                <span aria-hidden="true">{chooserOpen ? "▴" : "▾"}</span>
              </button>
            </div>
          ) : (
            <div key={tile.action} className="contents">
              {tileButton(tile, "panel w-full !rounded-xl", () => (tile.action === "PLAY" ? onPlay() : void act(tile.action, tile.outlook)))}
            </div>
          ),
        )}
      </div>

      {chooserOpen && (
        <div
          ref={chooserRef}
          id={chooserId}
          role="menu"
          aria-label="What to feed"
          onKeyDown={walkMenu}
          className="panel animate-pop flex w-full flex-col gap-0.5 !rounded-xl p-1.5"
        >
          <button
            type="button"
            role="menuitem"
            aria-disabled={!feed.ok}
            onClick={() => {
              if (feed.ok) choose(() => void act("FEED", feed.outlook));
            }}
            className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5 ${feed.ok ? "" : "cursor-not-allowed opacity-60"}`}
          >
            <span aria-hidden="true" className="w-6 text-center text-lg">
              🍚
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Plain meal</span>
              <span className="block truncate text-xs text-muted">{feed.hint ?? "The usual — as much as the pantry allows"}</span>
            </span>
            <span className="shrink-0 text-xs text-muted">free</span>
          </button>
          {entries.map(({ entry, count, ok, note }) => (
            <button
              key={entry.itemId}
              type="button"
              role="menuitem"
              aria-disabled={!ok}
              aria-label={`${entry.label}, ${count} in your pack${note ? ` — ${note}` : ""}`}
              onClick={() => {
                if (ok) choose(() => void act("FEED", null, entry));
              }}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5 ${ok ? "" : "cursor-not-allowed opacity-60"}`}
            >
              <span aria-hidden="true" className="w-6 text-center text-lg">
                {entry.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{entry.label}</span>
                {/* The lock's reason replaces the detail line, as on a shop row (SPEC §11.3). */}
                <span className="block truncate text-xs text-muted">{note ?? entry.detail}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted">×{count}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onShop)}
            className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-white/5 hover:text-foreground"
          >
            <span aria-hidden="true" className="w-6 text-center text-lg">
              🛒
            </span>
            <span className="flex-1">{entries.length === 0 ? "Pack's empty — shop for more" : "Shop for more"}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      <p aria-live="polite" className="min-h-5 text-center text-sm text-muted">
        {notice}
      </p>
    </div>
  );
}
