// What a shared link says about the pet right now (SPEC §21.7): the line
// under the link and the card beside it are both drawn from this one view,
// so a chat embed never shows a meter the description contradicts.
//
// A bare URL used to unfurl into a static card, so rallying the room around
// the day's goal meant typing the progress beside the link by hand. The
// embed can say it itself.

import { derive } from "@/sim/derive";
import { isAlive, type PetState } from "@/sim/model";
import { NEED_KEYS, type NeedKey } from "@/sim/tuning";
import { ageText, STAGE_LABELS } from "@/sim/lifetime";
import { db } from "./db/client";
import { env } from "./env";
import { runtime } from "./runtime";
import { questLine, questSettled, questView } from "./quests";

export type ShareView = {
  name: string;
  /** "Juvenile · 4d 6h", or what stands in for it before hatching and after. */
  status: string;
  /** Today's goal and how far the room has got, or null when there is no day to have one. */
  goal: string | null;
  /** The four needs and health, 0–100, or null for an egg or a memorial. */
  meters: (Record<NeedKey, number> & { health: number }) | null;
  /** One sentence for the link's description. */
  line: string;
};

const METER_LABELS: Record<NeedKey | "health", string> = {
  hunger: "Hunger",
  energy: "Energy",
  hygiene: "Hygiene",
  joy: "Joy",
  health: "Health",
};

const meterText = (meters: NonNullable<ShareView["meters"]>): string =>
  [...NEED_KEYS, "health" as const].map((need) => `${METER_LABELS[need]} ${meters[need]}%`).join(" · ");

const describe = (name: string, state: PetState): Pick<ShareView, "status" | "meters"> => {
  if (state.bornAtTick === null) return { status: "An egg, waiting for a name", meters: null };
  if (!isAlive(state)) return { status: `${name} has passed — a new egg is coming`, meters: null };
  const derived = derive(state);
  return { status: `${STAGE_LABELS[derived.stage] ?? derived.stage} · ${ageText(state)}`, meters: derived.percentages };
};

export const shareView = async (): Promise<ShareView> => {
  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  const name = current.name ?? "Makoto";
  const { status, meters } = describe(name, state);

  let goal: string | null = null;
  if (meters !== null) {
    const database = await db();
    const view = await questView(database, current, state, env().PET_TIMEZONE, Date.now());
    goal = questLine(view, await questSettled(database, current.id, view.dayIndex));
  }

  const line = meters === null ? status : [`${name} · ${status}`, meterText(meters), goal].filter(Boolean).join(" — ");
  return { name, status, goal, meters, line };
};
