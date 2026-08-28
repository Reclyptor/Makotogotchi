// The envelope published on the Redis events channel and fanned out over SSE
// (SPEC §7.2). Every state-bearing message carries its tick so clients can
// discard stale deliveries (SPEC §7.4).

import type { PetState } from "@/sim/model";
import type { CareEvent, Milestone } from "@/sim/events";
import type { MinigameId } from "@/sim/minigames";
import type { RecordScope } from "../records";
import type { Purse } from "../purse";

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

/**
 * Who is watching. It rides the `hello` payload as well as the `presence`
 * message: a client's first count must come from its own connect, not from
 * whichever broadcast happens to win the throttle next (SPEC §7.4).
 */
export type PresenceView = {
  count: number;
  caretakers: { id: string; name: string; titles: string[] }[];
  /** The current generation's leaderboard leader — wears the §2.11 crown. */
  crownedId?: string;
};

export type PresenceMessage = PresenceView & { type: "presence" };

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

/** A contested title changed hands (SPEC §24.2) — pure broadcast, no state. */
export type TitleMessage = {
  type: "title";
  titleId: string;
  caretakerId: string;
  caretakerName: string;
  previousId: string;
  previousName: string;
  value: number;
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

/** A want opened or lapsed (SPEC §25.2) — state-bearing, drives the banner. */
export type WantMessage = {
  type: "want";
  edge: "opened" | "expired";
  seq: number;
  tick: number;
  windowIndex: number;
  /** Present on "opened". */
  want?: { kind: string; itemId?: string };
  state: PetState;
};

/** A grand item finished funding (SPEC §21.8) — the names, not the fact. */
export type FundedMessage = {
  type: "funded";
  itemId: string;
  label: string;
  /** Top three givers, biggest first. */
  contributors: { name: string; amount: number }[];
};

/** The room changed its style (SPEC §22.5): every room changes together. */
export type ThemeMessage = {
  type: "theme";
  themeId: string;
  caretakerName: string;
};

/** Emoji reactions (SPEC §2.11) — pure broadcast, no state. */
export type ReactMessage = {
  type: "react";
  emoji: string;
  caretakerId: string;
  caretakerName: string;
};

/**
 * One caretaker's coins and pack (SPEC §13.1). The only message on this
 * channel addressed to a person rather than to the room — see deliverableTo.
 */
export type PurseMessage = { type: "purse"; caretakerId: string } & Purse;

export type EngineMessage =
  | CareMessage
  | MilestoneMessage
  | SnapshotMessage
  | PresenceMessage
  | MinigameMessage
  | WantMessage
  | TitleMessage
  | RecordMessage
  | FundedMessage
  | ThemeMessage
  | ReactMessage
  | PurseMessage;

/**
 * Whether a broadcast message belongs on this caretaker's socket (SPEC §7.2).
 *
 * The events channel is one Redis subscription per process fanned out to every
 * local client, so a per-caretaker payload reaches every connection and has to
 * be dropped at the edge. Kept pure and here, beside the messages themselves,
 * because it is a privacy boundary and deserves a test that does not need a
 * socket to run.
 */
export const deliverableTo = (message: EngineMessage, caretakerId: string): boolean =>
  message.type !== "purse" || message.caretakerId === caretakerId;
