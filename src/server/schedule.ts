// The ONLY timezone-aware code in the project (SPEC §4.5). Generates the
// sleep/wake boundary ticks that project() consumes as context, so src/sim
// never touches Intl or locale data. DST transitions fall out for free: this
// module computes each local 07:00 and 22:00 as an epoch instant, and a
// spring-forward or fall-back day simply yields a boundary at an unusual
// tick distance from its neighbors.

import type { PhaseSchedule } from "@/sim/model";
import { SLEEP_HOUR, TICK_SECONDS, WAKE_HOUR } from "@/sim/tuning";

const TICK_MS = TICK_SECONDS * 1000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const wallClockAt = (epochMs: number, timeZone: string): WallClock => {
  const parts = formatterFor(timeZone).formatToParts(epochMs);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // hour12:false can render midnight as 24.
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
};

/** Epoch instant of a local wall-clock time, correct across DST shifts. */
const localToEpoch = (wall: Omit<WallClock, "minute" | "second">, timeZone: string): number => {
  let epoch = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour);
  // Two refinement passes converge for any real-world offset, including the
  // transition days themselves.
  for (let pass = 0; pass < 2; pass++) {
    const seen = wallClockAt(epoch, timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    const wantAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour);
    epoch += wantAsUtc - seenAsUtc;
  }
  return epoch;
};

/**
 * The ISO-8601 week (`YYYY-Www`) an instant falls in, read off the pet's own
 * calendar. Weekly records roll over the moment this string changes — no job,
 * no cleanup: a new week simply has no rows yet (SPEC §21.3).
 */
export const isoWeekKey = (epochMs: number, timeZone: string): string => {
  const wall = wallClockAt(epochMs, timeZone);
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay(); // Monday = 1
  // Step to the week's Thursday: the year that Thursday lands in IS the
  // week-year, which is what makes late December and early January agree.
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const weekYear = date.getUTCFullYear();
  const week = Math.floor((date.getTime() - Date.UTC(weekYear, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
};

/** The same week, read off the pet's tick clock rather than the caller's. */
export const isoWeekKeyAtTick = (genesisEpochMs: number, tick: number, timeZone: string): string =>
  isoWeekKey(genesisEpochMs + tick * TICK_MS, timeZone);

/**
 * The schedule covering [fromTick, toTick]: initial phase plus every
 * sleep/wake boundary in range, in tick units relative to genesisEpochMs.
 */
export const scheduleFor = (
  genesisEpochMs: number,
  fromTick: number,
  toTick: number,
  timeZone: string,
): PhaseSchedule => {
  const fromMs = genesisEpochMs + fromTick * TICK_MS;
  const toMs = genesisEpochMs + toTick * TICK_MS;

  const boundaries: { tick: number; phase: "WAKE" | "SLEEP" }[] = [];
  // Start one local day early so the initial phase is derived from a real
  // boundary rather than guessed.
  let cursor = fromMs - DAY_MS;
  let initialPhase: "WAKE" | "SLEEP" = "WAKE";

  while (cursor <= toMs + DAY_MS) {
    const wall = wallClockAt(cursor, timeZone);
    for (const { hour, phase } of [
      { hour: WAKE_HOUR, phase: "WAKE" as const },
      { hour: SLEEP_HOUR, phase: "SLEEP" as const },
    ]) {
      const epoch = localToEpoch({ year: wall.year, month: wall.month, day: wall.day, hour }, timeZone);
      const tick = Math.ceil((epoch - genesisEpochMs) / TICK_MS);
      if (tick <= fromTick) {
        // The latest boundary at-or-before the window start defines the
        // initial phase. Boundaries are visited in chronological order.
        initialPhase = phase;
      } else if (tick <= toTick && epoch <= toMs) {
        boundaries.push({ tick, phase });
      }
    }
    cursor += DAY_MS;
  }

  boundaries.sort((a, b) => a.tick - b.tick);
  // A 23h/25h DST day can visit the same local date twice; drop duplicates.
  const deduped = boundaries.filter((boundary, index) => index === 0 || boundary.tick !== boundaries[index - 1]!.tick);
  return { initialPhase, boundaries: deduped };
};
