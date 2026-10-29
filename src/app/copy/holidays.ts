// How each holiday is worded (SPEC §22.11). The caption under the canvas, the
// feed, and the shop's closed ballot all say it, and must say it the same way.

import type { HolidayId } from "@/sim/holidays";
import type { CareAction } from "@/sim/tuning";
import { CHRISTMAS_ICONS } from "@/app/holidays/christmas";
import { HALLOWEEN_ICONS } from "@/app/holidays/halloween";
import { NEW_YEAR_ICONS } from "@/app/holidays/newYear";
import { THANKSGIVING_ICONS } from "@/app/holidays/thanksgiving";
import { VALENTINES_ICONS } from "@/app/holidays/valentines";

type HolidayCopy = {
  name: string;
  /** The mobile browser chrome's colour for the day. */
  themeColor: string;
  icon: string;
  /** Rides the caption slot all day, where an outing would read "Out at…". */
  caption: string;
  /** Replaces the care buttons' emoji, and the feed lines', for the day. */
  careIcons: Record<CareAction, string>;
  /** The once-a-day feed line. */
  dressedUp: (petName: string) => string;
};

export const HOLIDAY_COPY: Record<HolidayId, HolidayCopy> = {
  halloween: {
    name: "Halloween",
    themeColor: "#160b22",
    icon: "🎃",
    caption: "🎃 Happy Halloween!",
    careIcons: HALLOWEEN_ICONS,
    dressedUp: (petName) => `${petName} is dressed up as a wizard for Halloween!`,
  },
  thanksgiving: {
    name: "Thanksgiving",
    themeColor: "#1a0e0a",
    icon: "🦃",
    caption: "🦃 Happy Thanksgiving!",
    careIcons: THANKSGIVING_ICONS,
    dressedUp: (petName) => `${petName} is dressed up as a pilgrim for Thanksgiving!`,
  },
  christmas: {
    name: "Christmas",
    themeColor: "#0b1a13",
    icon: "🎄",
    caption: "🎄 Merry Christmas!",
    careIcons: CHRISTMAS_ICONS,
    dressedUp: (petName) => `${petName} is wearing a Santa suit for Christmas!`,
  },
  newYear: {
    name: "New Year's Day",
    themeColor: "#070b24",
    icon: "🎆",
    caption: "🎆 Happy New Year!",
    careIcons: NEW_YEAR_ICONS,
    dressedUp: (petName) => `${petName} is dressed up in a tux for the New Year!`,
  },
  valentines: {
    name: "Valentine's Day",
    themeColor: "#0b1020",
    icon: "🌹",
    caption: "🌹 Happy Valentine's Day!",
    careIcons: VALENTINES_ICONS,
    dressedUp: (petName) => `${petName} is dressed up as a crooner for Valentine's Day!`,
  },
};

/** Why the ballot is shut, and why a vote for the day is turned away. */
export const stayingHomeLine = (holidayId: HolidayId): string => `Makoto is staying home for ${HOLIDAY_COPY[holidayId].name}.`;

/**
 * The feed with the holiday's care icons on, resolved when it is drawn rather
 * than when a line arrives: the pet's zone, and so the holiday, reaches the
 * page with the stream, and a line can land before it does.
 */
export const dressFeed = <Entry extends { icon: string; care?: CareAction }>(
  entries: readonly Entry[],
  holidayId: HolidayId | null,
): readonly Entry[] =>
  holidayId
    ? entries.map((entry) => (entry.care ? { ...entry, icon: careIcon(entry.care, entry.icon, holidayId) } : entry))
    : entries;

/** A care action's icon: the holiday's when there is one, else the usual. */
export const careIcon = (action: CareAction, usual: string, holidayId: HolidayId | null): string =>
  holidayId ? HOLIDAY_COPY[holidayId].careIcons[action] : usual;
