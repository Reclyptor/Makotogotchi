// The snapshot payload shared by /api/state and the SSE stream (SPEC §7.2):
// everything a client needs to render now and project forward locally —
// state, derived view, clock alignment, and the phase schedule so the
// browser's project() sees the same sleep/wake boundaries as the server's.
// The zone name rides along too: the client needs the pet's own calendar to
// decide whether it has already been greeted today (SPEC §21.1).

import { derive, type DerivedState } from "@/sim/derive";
import type { Generation, PetState, PhaseSchedule } from "@/sim/model";
import { TICKS_PER_DAY, TICK_SECONDS } from "@/sim/tuning";
import { scheduleFor } from "./schedule";
import { env } from "./env";
import { db } from "./db/client";
import { roomState, type RoomView } from "./shop";

export type SnapshotPayload = {
  state: PetState;
  derived: DerivedState;
  serverTick: number;
  tickSeconds: number;
  genesisEpochMs: number;
  generation: { id: string; ordinal: number; name: string | null };
  phaseSchedule: PhaseSchedule;
  /** The pet's IANA zone — the calendar every client-side day boundary uses. */
  timeZone: string;
  room: RoomView;
};

// The communal room changes rarely; a short cache keeps snapshot assembly
// free of a Mongo read per SSE cycle per client.
let roomCache: { room: RoomView; at: number } | null = null;
const ROOM_TTL_MS = 10_000;

/**
 * Drop the cached room the moment it actually changes. Without this, a
 * client connecting just after a redecoration is handed the old room and
 * sits there looking at furniture nobody owns any more (SPEC §22.5).
 */
export const invalidateRoomCache = (): void => {
  roomCache = null;
};

const cachedRoom = async (): Promise<RoomView> => {
  if (roomCache && Date.now() - roomCache.at < ROOM_TTL_MS) return roomCache.room;
  const room = await roomState(await db());
  roomCache = { room, at: Date.now() };
  return room;
};

export const snapshotPayload = async (state: PetState, generation: Generation): Promise<SnapshotPayload> => ({
  state,
  derived: derive(state),
  serverTick: state.tick,
  tickSeconds: TICK_SECONDS,
  genesisEpochMs: generation.genesisEpochMs,
  generation: { id: generation.id, ordinal: generation.ordinal, name: state.generation.name },
  phaseSchedule: scheduleFor(generation.genesisEpochMs, state.tick, state.tick + 2 * TICKS_PER_DAY, env().PET_TIMEZONE),
  timeZone: env().PET_TIMEZONE,
  room: await cachedRoom(),
});
