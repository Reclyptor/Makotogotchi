// The snapshot payload shared by /api/state and the SSE stream (SPEC §7.2):
// everything a client needs to render now and project forward locally —
// state, derived view, clock alignment, and the phase schedule so the
// browser's project() sees the same sleep/wake boundaries as the server's.

import { derive, type DerivedState } from "@/sim/derive";
import type { Generation, PetState, PhaseSchedule } from "@/sim/model";
import { TICKS_PER_DAY, TICK_SECONDS } from "@/sim/tuning";
import { scheduleFor } from "./schedule";
import { env } from "./env";

export type SnapshotPayload = {
  state: PetState;
  derived: DerivedState;
  serverTick: number;
  tickSeconds: number;
  genesisEpochMs: number;
  generation: { id: string; ordinal: number; name: string | null };
  phaseSchedule: PhaseSchedule;
};

export const snapshotPayload = (state: PetState, generation: Generation): SnapshotPayload => ({
  state,
  derived: derive(state),
  serverTick: state.tick,
  tickSeconds: TICK_SECONDS,
  genesisEpochMs: generation.genesisEpochMs,
  generation: { id: generation.id, ordinal: generation.ordinal, name: state.generation.name },
  phaseSchedule: scheduleFor(generation.genesisEpochMs, state.tick, state.tick + 2 * TICKS_PER_DAY, env().PET_TIMEZONE),
});
