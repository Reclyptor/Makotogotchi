// The event vocabulary — the only inputs that ever mutate pet state — plus
// the zod schemas that validate them at every wire boundary (SPEC §8.4).
//
// Care events and HATCHED are real inputs: they carry information that cannot
// be derived from time (who acted; what the vote named the pet). MILESTONE
// events are records of what projection already determined — reduce() treats
// them as assertions, never as state changes — and exist so the feed, push
// notifications, and the memorial have a durable log to read.

import { z } from "zod";
import { CARE_ACTIONS } from "./tuning";
import { PERFORMANCE_MAX, PERFORMANCE_MIN } from "./economy";
import { WANT_KINDS } from "./wants";

export const NICKNAME_PATTERN = /^[\p{L}\p{N} _-]{2,16}$/u;

const eventBase = {
  generationId: z.string().min(1),
  /** Canonical fold order (SPEC §3.4) — per-generation, monotonic, unique. */
  seq: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
} as const;

export const careEventSchema = z.object({
  ...eventBase,
  type: z.literal("CARE"),
  action: z.enum(CARE_ACTIONS),
  caretakerId: z.string().min(1),
  /** A purchased item applied with the action (SPEC §13.2). */
  itemId: z.string().min(1).optional(),
  /** Minigame result scaling PLAY's magnitude, percent (SPEC §13.3). */
  performance: z.number().int().min(PERFORMANCE_MIN).max(PERFORMANCE_MAX).optional(),
});

/** Installs a communal toy for the rest of the generation (SPEC §13.2). */
export const toyAddedEventSchema = z.object({
  ...eventBase,
  type: z.literal("TOY_ADDED"),
  itemId: z.string().min(1),
});

export const hatchedEventSchema = z.object({
  ...eventBase,
  type: z.literal("HATCHED"),
  name: z.string().regex(NICKNAME_PATTERN),
});

export const MILESTONE_KINDS = [
  "HATCHED", // detail carries the voted name
  "EVOLVED",
  "SLEPT",
  "WOKE",
  "BECAME_SICK",
  "RECOVERED",
  "CRITICAL",
  "FADING", // an elder's health crossed below FADING_THRESHOLD (SPEC §2.10)
  "DIED",
  "AMBIENT", // detail carries the shared rare event's name (SPEC §21.5)
  "QUEST_DONE", // detail carries the completed quest's id (SPEC §21.7)
  "FUNDED", // detail carries the funded grand item's id (SPEC §21.8)
  "WANT_FULFILLED", // detail carries the want's kind, or kind:itemId (SPEC §25.3)
] as const;

export const milestoneEventSchema = z.object({
  ...eventBase,
  type: z.literal("MILESTONE"),
  kind: z.enum(MILESTONE_KINDS),
  detail: z.string().optional(),
});

/**
 * The measured size of the caring community (SPEC §23.2). Difficulty cannot
 * read a live count at projection time without breaking replay, so the
 * leader records it here whenever it moves the multiplier a step.
 */
export const populationEventSchema = z.object({
  ...eventBase,
  type: z.literal("POPULATION"),
  count: z.number().int().min(0).max(1_000_000),
});

/**
 * The leader opened a window's want (SPEC §25.2). Like POPULATION, this is a
 * real fold input: whether the pet was awake for the window is schedule
 * knowledge the sim lacks, so it enters as an event. The payload is
 * authoritative — reduce() folds what it says was wanted, never re-deriving
 * from wantAt, so retuning catalogs cannot re-fold an old log.
 */
export const wantOpenedEventSchema = z.object({
  ...eventBase,
  type: z.literal("WANT_OPENED"),
  windowIndex: z.number().int().nonnegative(),
  want: z.object({
    kind: z.enum(WANT_KINDS),
    itemId: z.string().min(1).optional(),
  }),
});

/** The want lapsed: a clamped joy debit, appended by the leader (SPEC §25.2). */
export const wantExpiredEventSchema = z.object({
  ...eventBase,
  type: z.literal("WANT_EXPIRED"),
  windowIndex: z.number().int().nonnegative(),
});

export const petEventSchema = z.discriminatedUnion("type", [
  careEventSchema,
  hatchedEventSchema,
  toyAddedEventSchema,
  milestoneEventSchema,
  populationEventSchema,
  wantOpenedEventSchema,
  wantExpiredEventSchema,
]);

export type CareEvent = z.infer<typeof careEventSchema>;
export type HatchedEvent = z.infer<typeof hatchedEventSchema>;
export type ToyAddedEvent = z.infer<typeof toyAddedEventSchema>;
export type MilestoneEvent = z.infer<typeof milestoneEventSchema>;
export type PopulationEvent = z.infer<typeof populationEventSchema>;
export type WantOpenedEvent = z.infer<typeof wantOpenedEventSchema>;
export type WantExpiredEvent = z.infer<typeof wantExpiredEventSchema>;
export type PetEvent = z.infer<typeof petEventSchema>;

export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

/** A milestone produced by projection or by applying an event, pre-log. */
export type Milestone = { kind: MilestoneKind; tick: number; detail?: string };
