import { describe, expect, it } from "vitest";
import {
  ARRIVE_MS,
  createTable,
  LEAVE_MS,
  PATIENCE_MS,
  RELOAD_MS,
  SEATS,
  SERVED_MS,
  serve,
  advance,
  wantedDishes,
  WRONG_COST_MS,
  type Dish,
  type Rng,
  type Table,
} from "./sausagePartyRules";

/** mulberry32 — small, seedable, good enough to walk a table 5 000 steps. */
const seeded = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** An rng that returns a fixed sequence, then zeros. */
const scripted = (...values: number[]): Rng => {
  let index = 0;
  return () => values[index++] ?? 0;
};

const seated = (table: Table, rng: Rng): Table => advance(table, ARRIVE_MS, rng).table;

const waitingSeat = (table: Table, dish: Dish): number =>
  table.guests.findIndex((guest) => guest.phase === "waiting" && guest.wants === dish);

describe("the tray", () => {
  it("opens holding something a guest at the table asked for", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const table = createTable(seeded(seed));
      expect(wantedDishes(table.guests)).toContain(table.tray);
    }
  });

  it("is never a dish nobody wants while anyone is waiting — across thousands of random steps", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seeded(seed);
      let table = createTable(rng);
      for (let step = 0; step < 5000; step++) {
        table = advance(table, 16 + Math.floor(rng() * 300), rng).table;
        if (rng() < 0.3) table = serve(table, Math.floor(rng() * SEATS)).table;
        const waiting = table.guests.some((guest) => guest.phase === "waiting");
        if (table.tray !== null && waiting) {
          expect(wantedDishes(table.guests)).toContain(table.tray);
        }
      }
    }
  });

  it("is taken back and re-plated when its only taker walks out", () => {
    // Three guests wanting three different dishes; the tray is for seat 0.
    let table: Table = {
      guests: [
        { wants: "partyPlate", patience: 1, phase: "waiting", phaseMs: 0 },
        { wants: "coffeeMug", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
        { wants: "onigiri", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
      ],
      tray: "partyPlate",
      next: "coffeeMug",
      platingMs: 0,
      served: 0,
      walkouts: 0,
    };
    // Seat 0 gives up. Nobody else wants the party plate, and a guest
    // storming off is no longer asking, so the kitchen takes it back at once.
    const result = advance(table, 1, scripted(0.99));
    expect(result.events).toEqual([{ kind: "walkout", seat: 0 }, { kind: "replated" }]);
    expect(result.table.tray).toBeNull();
    expect(result.table.platingMs).toBe(RELOAD_MS);
    // What comes up instead is something the remaining guests are holding up.
    table = advance(result.table, RELOAD_MS, scripted(0.99, 0.99)).table;
    expect(["coffeeMug", "onigiri"]).toContain(table.tray);
  });

  it("stays plated when nobody at all is asking, until someone sits down", () => {
    let table: Table = {
      guests: [
        { wants: "fish", patience: PATIENCE_MS, phase: "served", phaseMs: SERVED_MS },
        { wants: "fish", patience: PATIENCE_MS, phase: "leaving", phaseMs: LEAVE_MS },
        { wants: "fish", patience: PATIENCE_MS, phase: "leaving", phaseMs: LEAVE_MS },
      ],
      tray: "onigiri",
      next: "fish",
      platingMs: 0,
      served: 1,
      walkouts: 2,
    };
    expect(advance(table, 1, scripted(0)).table.tray).toBe("onigiri");
    // The seats turn over to guests who all want the party plate: re-plated.
    table = advance(table, SERVED_MS, scripted(0, 0, 0)).table;
    expect(table.guests.every((guest) => guest.wants === "partyPlate")).toBe(true);
    expect(table.tray).toBeNull();
  });

  it("swaps a stale preview at plating time instead of serving it", () => {
    let table: Table = {
      guests: [
        { wants: "onigiri", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
        { wants: "onigiri", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
        { wants: "onigiri", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
      ],
      tray: null,
      next: "fish", // dealt for a guest who has since gone
      platingMs: RELOAD_MS,
      served: 0,
      walkouts: 0,
    };
    table = advance(table, RELOAD_MS, scripted(0, 0)).table;
    expect(table.tray).toBe("onigiri");
  });
});

describe("serving", () => {
  const rng = seeded(7);
  const base = seated(createTable(rng), rng);

  it("a right guest is a point, the seat celebrates, and the kitchen starts plating", () => {
    const seat = waitingSeat(base, base.tray!);
    expect(seat).toBeGreaterThanOrEqual(0);
    const { table, outcome } = serve(base, seat);
    expect(outcome).toEqual({ kind: "served", seat });
    expect(table.served).toBe(1);
    expect(table.tray).toBeNull();
    expect(table.platingMs).toBe(RELOAD_MS);
    expect(table.guests[seat]).toMatchObject({ phase: "served", phaseMs: SERVED_MS });
  });

  it("a wrong guest loses patience and says how much", () => {
    const seat = base.guests.findIndex((guest) => guest.phase === "waiting" && guest.wants !== base.tray);
    expect(seat).toBeGreaterThanOrEqual(0);
    const { table, outcome } = serve(base, seat);
    expect(outcome).toEqual({ kind: "wrong", seat, patienceBefore: PATIENCE_MS });
    expect(table.guests[seat]?.patience).toBe(PATIENCE_MS - WRONG_COST_MS);
    expect(table.served).toBe(0);
  });

  it("a tap while plating is answered as such, never swallowed", () => {
    const seat = waitingSeat(base, base.tray!);
    const plating = serve(base, seat).table;
    expect(serve(plating, (seat + 1) % SEATS).outcome).toEqual({ kind: "plating" });
  });

  it("a guest still sitting down or already served cannot be served", () => {
    const fresh = createTable(seeded(3));
    expect(serve(fresh, 0).outcome).toEqual({ kind: "unavailable" });
    const table: Table = {
      guests: [
        { wants: "fish", patience: PATIENCE_MS, phase: "served", phaseMs: SERVED_MS },
        { wants: "fish", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
        { wants: "fish", patience: PATIENCE_MS, phase: "leaving", phaseMs: LEAVE_MS },
      ],
      tray: "fish",
      next: "fish",
      platingMs: 0,
      served: 1,
      walkouts: 1,
    };
    expect(serve(table, 0).outcome).toEqual({ kind: "unavailable" });
    expect(serve(table, 2).outcome).toEqual({ kind: "unavailable" });
    expect(serve(table, 1).outcome).toEqual({ kind: "served", seat: 1 });
  });
});

describe("walking out", () => {
  it("is a visible phase before the seat turns over, and is counted", () => {
    const rng = seeded(11);
    let table = seated(createTable(rng), rng);
    const result = advance(table, PATIENCE_MS, rng);
    expect(result.events.filter((event) => event.kind === "walkout")).toHaveLength(SEATS);
    table = result.table;
    expect(table.walkouts).toBe(SEATS);
    for (const guest of table.guests) expect(guest).toMatchObject({ phase: "leaving", phaseMs: LEAVE_MS, patience: 0 });
    table = advance(table, LEAVE_MS, rng).table;
    for (const guest of table.guests) expect(guest.phase).toBe("arriving");
  });

  it("a wrong plate that empties the patience bar ends in a walkout on the next beat", () => {
    let table: Table = {
      guests: [
        { wants: "fish", patience: WRONG_COST_MS, phase: "waiting", phaseMs: 0 },
        { wants: "fish", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
        { wants: "fish", patience: PATIENCE_MS, phase: "waiting", phaseMs: 0 },
      ],
      tray: "onigiri",
      next: "fish",
      platingMs: 0,
      served: 0,
      walkouts: 0,
    };
    table = serve(table, 0).table;
    expect(table.guests[0]?.patience).toBe(0);
    const { events } = advance(table, 1, scripted(0));
    expect(events).toContainEqual({ kind: "walkout", seat: 0 });
  });
});
