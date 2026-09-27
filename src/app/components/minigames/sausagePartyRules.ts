// Sausage Party's rules (SPEC §13.3.3), with no canvas in them: who is at
// the table, what they are holding up, what is on the tray, and what a tap
// does about it. The component renders a Table and feeds taps back in; the
// randomness is injected so every rule here can be tested step by step.
//
// The rule that matters most is the one the first version broke: the
// kitchen never sends out a dish nobody at the table asked for. A tray that
// nobody wants cannot be discarded, so it used to stall the run until a
// guest happened to walk out and a new one happened to want it — which read
// as failing for no reason, because it was.

import type { FrameName } from "@/game/atlas.generated";

export const SEATS = 3;

// What can be asked for. Sausage first, because that is the whole joke.
export const DISHES = ["partyPlate", "coffeeMug", "onigiri", "fish"] as const satisfies readonly FrameName[];
export type Dish = (typeof DISHES)[number];

export const PATIENCE_MS = 7000; // a guest waits this long before giving up
export const WRONG_COST_MS = 2200; // and loses this much of it to a wrong plate
export const SERVED_MS = 700; // celebrating before the seat turns over
export const ARRIVE_MS = 500; // sitting down, before they can be served
export const LEAVE_MS = 600; // storming off, before the seat turns over
// The next dish takes a moment to come up, which is what paces the game —
// without it the only limit on scoring would be how fast a player can tap.
export const RELOAD_MS = 900;

export type GuestPhase = "arriving" | "waiting" | "served" | "leaving";

export type Guest = {
  wants: Dish;
  /** Counts down only while waiting; a wrong plate takes a chunk off it. */
  patience: number;
  phase: GuestPhase;
  /** Time left in any phase but waiting, which patience governs instead. */
  phaseMs: number;
};

export type Table = {
  /** One entry per seat, always. */
  guests: readonly Guest[];
  /** What is being served, or null while the kitchen is plating. */
  tray: Dish | null;
  /** What comes up when the plating ends — the preview under the tray. */
  next: Dish;
  platingMs: number;
  served: number;
  walkouts: number;
};

export type TableEvent = { kind: "walkout"; seat: number } | { kind: "replated" };

export type ServeOutcome =
  | { kind: "served"; seat: number }
  | { kind: "wrong"; seat: number; patienceBefore: number }
  /** Nothing on the tray yet — the tap is answered, not swallowed. */
  | { kind: "plating" }
  /** An empty or busy seat, or nobody at it who can be served. */
  | { kind: "unavailable" };

/** A number in [0, 1), like Math.random — injected so the rules are testable. */
export type Rng = () => number;

const pickFrom = <T>(options: readonly T[], rng: Rng): T => options[Math.floor(rng() * options.length)]!;

const newGuest = (rng: Rng): Guest => ({
  wants: pickFrom(DISHES, rng),
  patience: PATIENCE_MS,
  phase: "arriving",
  phaseMs: ARRIVE_MS,
});

/**
 * What the table is asking for: the wants of everyone seated or sitting
 * down. One entry per guest, so a dish two guests hold up is twice as likely
 * to be dealt. Guests being served or leaving are not asking for anything.
 */
export const wantedDishes = (guests: readonly Guest[]): Dish[] =>
  guests.filter((guest) => guest.phase === "arriving" || guest.phase === "waiting").map((guest) => guest.wants);

/**
 * Deal a dish the table wants. The only time nobody wants anything is when
 * every seat is turning over at once — a serve and two walkouts inside the
 * same beat — and then any dish will do until someone sits down, when the
 * check in `advance` looks again.
 */
const deal = (guests: readonly Guest[], rng: Rng): Dish => {
  const wanted = wantedDishes(guests);
  return wanted.length > 0 ? pickFrom(wanted, rng) : pickFrom(DISHES, rng);
};

export const createTable = (rng: Rng): Table => {
  const guests = Array.from({ length: SEATS }, () => newGuest(rng));
  return { guests, tray: deal(guests, rng), next: deal(guests, rng), platingMs: 0, served: 0, walkouts: 0 };
};

/** Move the table on by `dtMs`: guests arrive, wait, celebrate, leave, and the kitchen plates. */
export const advance = (table: Table, dtMs: number, rng: Rng): { table: Table; events: TableEvent[] } => {
  const events: TableEvent[] = [];
  let walkouts = table.walkouts;

  const guests = table.guests.map((guest, seat): Guest => {
    if (guest.phase === "waiting") {
      const patience = guest.patience - dtMs;
      if (patience > 0) return { ...guest, patience };
      // Out of patience: they give up, visibly, and the seat turns over after.
      events.push({ kind: "walkout", seat });
      walkouts += 1;
      return { ...guest, patience: 0, phase: "leaving", phaseMs: LEAVE_MS };
    }
    const phaseMs = guest.phaseMs - dtMs;
    if (phaseMs > 0) return { ...guest, phaseMs };
    if (guest.phase === "arriving") return { ...guest, phase: "waiting", phaseMs: 0 };
    return newGuest(rng);
  });

  let tray = table.tray;
  let next = table.next;
  let platingMs = Math.max(0, table.platingMs - dtMs);

  if (tray === null && platingMs === 0) {
    // Plating done. The preview was dealt against an earlier table; if the
    // guest it was for has gone, it is quietly swapped rather than served.
    const wanted = wantedDishes(guests);
    tray = wanted.includes(next) ? next : deal(guests, rng);
    next = deal(guests, rng);
  } else if (tray !== null) {
    // If the only guest asking for the dish on the tray has just given up,
    // the kitchen takes it back and plates another — the player is never
    // left holding a dish with no taker. Checked every step: a walkout
    // stops asking the moment it starts, well before the seat turns over.
    const wanted = wantedDishes(guests);
    if (wanted.length > 0 && !wanted.includes(tray)) {
      tray = null;
      platingMs = RELOAD_MS;
      events.push({ kind: "replated" });
    }
  }

  return { table: { guests, tray, next, platingMs, served: table.served, walkouts }, events };
};

/** Offer the tray to the guest in `seat`. */
export const serve = (table: Table, seat: number): { table: Table; outcome: ServeOutcome } => {
  if (table.tray === null) return { table, outcome: { kind: "plating" } };
  const guest = table.guests[seat];
  if (!guest || guest.phase !== "waiting") return { table, outcome: { kind: "unavailable" } };

  if (guest.wants === table.tray) {
    const guests = table.guests.map((other, index) =>
      index === seat ? { ...other, phase: "served" as const, phaseMs: SERVED_MS } : other,
    );
    return {
      table: { ...table, guests, tray: null, platingMs: RELOAD_MS, served: table.served + 1 },
      outcome: { kind: "served", seat },
    };
  }

  const guests = table.guests.map((other, index) =>
    index === seat ? { ...other, patience: Math.max(0, other.patience - WRONG_COST_MS) } : other,
  );
  return { table: { ...table, guests }, outcome: { kind: "wrong", seat, patienceBefore: guest.patience } };
};
