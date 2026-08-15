// The fold. reduce(state, event, ctx) projects to the event's tick, then
// applies it. Folding a generation's event log in seq order through this
// function reproduces its exact state on any machine (SPEC §3.1) — the
// determinism the golden-file test guards.

import { phaseAt, type PetState, type ProjectionContext } from "./model";
import { project } from "./project";
import { caretakerRecord, pruneCaretakers, recordApplied } from "./score";
import {
  ACTION_MAGNITUDE,
  HEALTH_MAX,
  MEDICATE_HEALTH_RESTORE,
  NEED_MAX,
  PLAY_ENERGY_COST,
  type CareAction,
  type NeedKey,
} from "./tuning";
import { budgetRemaining } from "./score";
import type { Milestone, PetEvent } from "./events";

export type ReduceResult = {
  state: PetState;
  milestones: Milestone[];
  /** Need units actually restored by a care action (post-curve, post-budget). */
  applied: number;
};

/** Diminishing returns (SPEC §2.6) — integer round-half-up, no float division. */
export const diminishedMagnitude = (base: number, current: number): number =>
  Math.floor((base * (NEED_MAX - current) + NEED_MAX / 2) / NEED_MAX);

const clamp = (value: number, max: number): number => (value < 0 ? 0 : value > max ? max : value);

/** Magnitude-shaped actions and the need each restores (MEDICATE is flat). */
const MAGNITUDE_ACTIONS: Partial<Record<CareAction, { need: NeedKey; base: number }>> = {
  FEED: { need: "hunger", base: ACTION_MAGNITUDE.FEED },
  PLAY: { need: "joy", base: ACTION_MAGNITUDE.PLAY },
  CLEAN: { need: "hygiene", base: ACTION_MAGNITUDE.CLEAN },
  LULLABY: { need: "energy", base: ACTION_MAGNITUDE.LULLABY },
  PET: { need: "joy", base: ACTION_MAGNITUDE.PET },
};

export const reduce = (input: PetState, event: PetEvent, ctx: ProjectionContext): ReduceResult => {
  if (event.tick < input.tick) {
    throw new Error(`event out of order: state at tick ${input.tick}, event at ${event.tick} (seq ${event.seq})`);
  }
  const projected = project(input, event.tick, ctx);
  const state = structuredClone(projected.state) as PetState;
  const milestones = [...projected.milestones];

  switch (event.type) {
    case "MILESTONE":
      // A record of what projection already determined — no state effect.
      return { state, milestones, applied: 0 };

    case "HATCHED": {
      state.bornAtTick = event.tick;
      state.generation = { ...state.generation, name: event.name };
      state.needs = { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX };
      state.healthRaw = HEALTH_MAX;
      state.asleep = false;
      state.sleepReason = null;
      return { state, milestones, applied: 0 };
    }

    case "CARE": {
      // Validity is the server's concern before the event is ever appended;
      // reduce applies what the log says happened. This keeps replay total:
      // a log written by an older ruleset still folds.
      const record = caretakerRecord(state, event.caretakerId);
      let applied = 0;

      if (event.action === "MEDICATE") {
        if (state.sick) {
          state.sick = false;
          state.sickSinceTick = null;
          milestones.push({ kind: "RECOVERED", tick: event.tick });
        }
        state.healthRaw = clamp(state.healthRaw + MEDICATE_HEALTH_RESTORE, HEALTH_MAX);
      } else {
        const magnitude = MAGNITUDE_ACTIONS[event.action];
        if (magnitude) {
          const curved = diminishedMagnitude(magnitude.base, state.needs[magnitude.need]);
          applied = Math.min(curved, budgetRemaining(record, magnitude.need, event.tick));
          state.needs[magnitude.need] = clamp(state.needs[magnitude.need] + applied, NEED_MAX);
          recordApplied(record, magnitude.need, event.tick, applied);
        }
        if (event.action === "PLAY") {
          state.needs.energy = clamp(state.needs.energy - PLAY_ENERGY_COST, NEED_MAX);
        }
        if (event.action === "LULLABY" && !state.asleep) {
          state.asleep = true;
          state.sleepReason = phaseAt(ctx.schedule, event.tick) === "SLEEP" ? "NIGHT" : "LULLABY";
          milestones.push({ kind: "SLEPT", tick: event.tick });
        }
      }

      state.lastActionTick[event.action] = event.tick;
      record.lastActionTick[event.action] = event.tick;
      pruneCaretakers(state, event.tick);
      return { state, milestones, applied };
    }
  }
};
