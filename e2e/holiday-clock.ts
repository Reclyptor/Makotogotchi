// The pet's calendar, for the e2e specs that pin the browser's clock to a day.
//
// The pet's zone is not a constant here. start-stack.mjs pins it to whichever
// Etc/GMT zone makes "now" midday, so it moves with the hour CI runs at, and an
// instant written for America/Chicago lands on another day in it. The specs
// ask the server for its zone and build their instants in that.

import type { APIRequestContext } from "@playwright/test";

/** The pet's zone, as the server announces it to every client. */
export const petZone = async (request: APIRequestContext): Promise<string> => {
  const response = await request.get("/api/state");
  return ((await response.json()) as { timeZone: string }).timeZone;
};

/** What the wall clock in `zone` reads at an instant, as if it were UTC. */
const wallClockMs = (zone: string, instantMs: number): number => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instantMs);
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(field("year"), field("month") - 1, field("day"), field("hour"), field("minute"));
};

/** The instant at which the wall clock in `zone` reads `year`-`month`-`day`, `hour`:`minute`. */
export const instantIn = (zone: string, year: number, month: number, day: number, hour: number, minute = 0): Date => {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at the wanted wall time is the gap between the two
  // readings; one correction lands exactly, two covers a DST change.
  let instant = wanted;
  for (let pass = 0; pass < 2; pass++) instant += wanted - wallClockMs(zone, instant);
  return new Date(instant);
};
