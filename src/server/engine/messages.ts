// The envelope published on the Redis events channel and fanned out over SSE
// (SPEC §7.2). Every state-bearing message carries its tick so clients can
// discard stale deliveries (SPEC §7.4).

import type { PetState } from "@/sim/model";
import type { CareEvent, Milestone } from "@/sim/events";
import type { MinigameId } from "@/sim/minigames";
import type { RecordScope } from "../records";

export type CareMessage = {
  type: "care";
  /** Event-log seq — lets clients merge live messages with /api/feed history. */
  seq: number;
  tick: number;
  action: CareEvent["action"];
  caretakerId: string;
  caretakerName?: string;
  /** The purchased item applied with the action, when there was one. */
  itemId?: string;
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
  /** Which game of the roster (src/sim/minigames.ts) is being played. */
  game?: string;
  score?: number;
  applied?: number;
};

/** A new per-game high score (SPEC §21.3) — pure broadcast, no state. */
export type RecordMessage = {
  type: "record";
  game: MinigameId;
  scope: RecordScope;
  score: number;
  caretakerId: string;
  caretakerName: string;
};

/** A grand item finished funding (SPEC §21.8) — the names, not the fact. */
export type FundedMessage = {
  type: "funded";
  itemId: string;
  label: string;
  /** Top three givers, biggest first. */
  contributors: { name: string; amount: number }[];
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
  | RecordMessage
  | FundedMessage
  | ReactMessage;
