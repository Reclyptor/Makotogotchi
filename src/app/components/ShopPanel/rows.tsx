"use client";

// How a shop row is drawn. One shape for every item in every tab — icon, name
// over a line of detail, a fixed action slot on the right — because that
// alignment is most of what makes a long list readable (SPEC §13.2).
//
// The locked-control rule (SPEC §11.3) is implemented once, here, in
// ActionButton: no `.press`, so the sheen and the hover lift are gone; the
// reason in the accessible name; and the reason in place of the detail line,
// where it is actually read. Nothing above this file gets to decide how a
// refusal looks.

import type { Availability, ShopRow, ShopRowAction } from "./tabs";

export type RowHandlers = {
  buy: (itemId: string, label: string) => void;
  use: (itemId: string, care: "FEED" | "MEDICATE") => void;
  chipIn: (itemId: string, amount: 10 | 50 | "all") => void;
  vote: (venueId: string, tickets: number) => void;
  wear: (itemId: string | null) => void;
  switchTheme: (themeId: string) => void;
};

export const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-semibold text-mint">{children}</span>
);

type ActionButtonProps = {
  availability: Availability;
  /** The accessible name before any reason is appended. */
  name: string;
  tone: "price" | "quiet";
  onClick: () => void;
  children: React.ReactNode;
};

const ActionButton = ({ availability, name, tone, onClick, children }: ActionButtonProps) => {
  const locked = !availability.ok;
  const base = "w-full rounded-lg px-2 py-1.5 text-center text-xs font-bold tabular-nums";
  // Filled versus hollow, not 10% white versus 6% white. Two greys a shade
  // apart is what made "Use" look the same whether or not Makoto could take
  // it — the difference has to survive a glance on a phone in daylight.
  const live =
    tone === "price" ? "press bg-accent-strong text-white" : "press bg-accent/25 font-semibold text-foreground hover:bg-accent/45";
  // A price you cannot meet is struck through; a verb you cannot perform is
  // not — "U̶s̶e̶" reads as a typo, where "🪙̶ ̶2̶5̶0̶" reads as out of reach.
  const dead = `cursor-not-allowed bg-white/[0.03] text-muted/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]${
    tone === "price" ? " line-through decoration-1" : ""
  }`;
  return (
    <button
      type="button"
      onClick={() => {
        if (!availability.ok) return;
        onClick();
      }}
      aria-disabled={locked}
      aria-label={availability.ok ? name : `${name} — ${availability.note}`}
      className={`${base} ${locked ? dead : live}`}
    >
      {children}
    </button>
  );
};

/** How far a pool has come, and how far it still has to go. */
const PoolTrack = ({ pooled, price }: { pooled: number; price: number }) => (
  <span className="mt-1 flex items-center gap-2">
    <span aria-hidden="true" className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
      <span
        className="block h-full rounded-full bg-gold transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(100, (pooled / price) * 100)}%` }}
      />
    </span>
    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gold">
      {pooled}/{price} 🪙
    </span>
  </span>
);

/**
 * A venue's share of tomorrow. Deliberately the accent rather than the gold a
 * pool uses: gold is coins owed toward a price, and this is not a debt being
 * paid down — it is how likely tomorrow is to go this way.
 */
const OddsTrack = ({ tickets, total }: { tickets: number; total: number }) => (
  <span className="mt-1 flex items-center gap-2">
    <span aria-hidden="true" className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(100, (tickets / Math.max(1, total)) * 100)}%` }}
      />
    </span>
    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-accent">
      {tickets}/{total} 🎟️
    </span>
  </span>
);

/**
 * The reason a row's action cannot be taken — null while any part of it still
 * can, so a pool you can put 10 into does not announce that you cannot put in
 * 50.
 */
const lockNote = (action: ShopRowAction): string | null => {
  const offered: Availability[] =
    action.kind === "buy" || action.kind === "use"
      ? [action.availability]
      : action.kind === "fund" || action.kind === "vote"
        ? action.offers.map((offer) => offer.availability)
        : [];
  const blocked = offered.every((availability) => !availability.ok) ? offered[0] : undefined;
  return blocked !== undefined && !blocked.ok ? blocked.note : null;
};

const Action = ({ row, on }: { row: ShopRow; on: RowHandlers }) => {
  const action = row.action;
  switch (action.kind) {
    case "badge":
      return <Badge>{action.label}</Badge>;
    case "buy":
      return (
        <ActionButton
          availability={action.availability}
          name={`Buy ${row.name} for ${action.price} coins`}
          tone="price"
          onClick={() => on.buy(action.itemId, row.name)}
        >
          🪙 {action.price}
        </ActionButton>
      );
    case "use":
      return (
        <ActionButton
          availability={action.availability}
          name={`Use ${row.name}`}
          tone="quiet"
          onClick={() => on.use(action.itemId, action.care)}
        >
          Use
        </ActionButton>
      );
    case "wear":
      return (
        <ActionButton
          availability={{ ok: true }}
          name={`${action.label} ${row.name}`}
          tone="quiet"
          onClick={() => on.wear(action.itemId)}
        >
          {action.label}
        </ActionButton>
      );
    case "theme":
      return (
        <ActionButton
          availability={{ ok: true }}
          name={`Change the room to ${row.name}`}
          tone="quiet"
          onClick={() => on.switchTheme(action.themeId)}
        >
          Use
        </ActionButton>
      );
    case "fund":
      return (
        <span className="flex w-full gap-1">
          {action.offers.map((offer) => (
            <ActionButton
              key={offer.label}
              availability={offer.availability}
              name={`Chip in ${offer.coins} coins toward ${row.name}`}
              tone="price"
              onClick={() => on.chipIn(action.itemId, offer.amount)}
            >
              {offer.label}
            </ActionButton>
          ))}
        </span>
      );
    case "vote":
      return (
        <span className="flex w-full gap-1">
          {action.offers.map((offer) => (
            <ActionButton
              key={offer.label}
              availability={offer.availability}
              name={`Back ${row.name} for tomorrow with ${offer.coins} coins`}
              tone="price"
              onClick={() => on.vote(action.venueId, offer.tickets)}
            >
              {offer.label}
            </ActionButton>
          ))}
        </span>
      );
  }
};

export const Row = ({ row, on }: { row: ShopRow; on: RowHandlers }) => {
  const note = lockNote(row.action);
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_6.75rem] items-center gap-3 rounded-2xl px-2.5 py-2 hover:bg-white/[0.04]">
      <span aria-hidden="true" className="text-lg leading-none">
        {row.icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">{row.name}</p>
        {/* The reason takes the detail line rather than hiding in a tooltip —
            a tooltip does not exist on a phone (SPEC §11.3). */}
        <p className={`truncate text-[11px] leading-tight ${note ? "text-foreground/85" : "text-muted"}`}>
          {note ?? row.detail}
        </p>
        {row.pool && <PoolTrack pooled={row.pool.pooled} price={row.pool.price} />}
        {row.odds && <OddsTrack tickets={row.odds.tickets} total={row.odds.total} />}
      </div>
      <div className="flex justify-end">
        <Action row={row} on={on} />
      </div>
    </li>
  );
};
