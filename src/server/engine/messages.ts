// The envelope published on the Redis events channel and fanned out over SSE
// (SPEC §7.2). Every state-bearing message carries its tick so clients can
// discard stale deliveries (SPEC §7.4).

import type { PetState } from "@/sim/model";
import type { CareEvent, Milestone } from "@/sim/events";

export type CareMessage = {
  type: "care";
  tick: number;
  action: CareEvent["action"];
  caretakerId: string;
  applied: number;
  state: PetState;
};

export type MilestoneMessage = {
  type: "milestone";
  tick: number;
  kind: Milestone["kind"];
  detail?: string;
  state: PetState;
};

export type SnapshotMessage = {
  type: "snapshot";
  tick: number;
  state: PetState;
};

export type EngineMessage = CareMessage | MilestoneMessage | SnapshotMessage;
