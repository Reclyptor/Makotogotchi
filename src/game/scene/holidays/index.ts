// Each holiday's scene, by id (SPEC §22.11). A new holiday is a new file beside
// `halloween.ts` and a line here; the compiler insists on the line.

import type { HolidayId } from "@/sim/holidays";
import { CHRISTMAS_SCENE } from "./christmas";
import { HALLOWEEN_SCENE } from "./halloween";
import { NEW_YEAR_SCENE } from "./newYear";
import { THANKSGIVING_SCENE } from "./thanksgiving";
import { VALENTINES_SCENE } from "./valentines";
import type { HolidayScene } from "./scene";

const SCENES: Record<HolidayId, HolidayScene> = {
  halloween: HALLOWEEN_SCENE,
  thanksgiving: THANKSGIVING_SCENE,
  christmas: CHRISTMAS_SCENE,
  newYear: NEW_YEAR_SCENE,
  valentines: VALENTINES_SCENE,
};

export const holidayScene = (id: HolidayId): HolidayScene => SCENES[id];

export type { HolidayProp, HolidayScene } from "./scene";
