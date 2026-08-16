// The envelope published on the Redis events channel and fanned out over SSE
// (SPEC §7.2). Every state-bearing message carries its tick so clients can
// discard stale deliveries (SPEC §7.4).

import type { PetState } from "@/sim/model";
import type { CareEvent, Milestone } from "@/sim/events";

export type CareMessage = {
  type: "care";
  /** Event-log seq — lets clients merge live messages with /api/feed history. */
  seq: number;
  tick: number;
  action: CareEvent["action"];
  caretakerId: string;
  caretakerName?: string;
  applied: number;
  state: PetState;
};

export type MilestoneMessage = {
  type: "milestone";
  seq: number;
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

export type PresenceMessage = {
  type: "presence";
  count: number;
  caretakers: { id: string; name: string }[];
};

/** Live minigame spectacle (SPEC §13.3): everyone watches the run. */
export type MinigameMessage = {
  type: "minigame";
  phase: "start" | "score" | "finish";
  caretakerId: string;
  caretakerName?: string;
  score?: number;
  applied?: number;
};

/** Emoji reactions (SPEC §2.11) — pure broadcast, no state. */
export type ReactMessage = {
  type: "react";
  emoji: string;
  caretakerId: string;
  caretakerName: string;
};

export type EngineMessage =
  | CareMessage
  | MilestoneMessage
  | SnapshotMessage
  | PresenceMessage
  | MinigameMessage
  | ReactMessage;
