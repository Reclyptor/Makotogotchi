// The full circle of life against real stores (SPEC §2.10): hatch → care →
// abandonment → death → seal (memorial, tenure) → mourning → next egg →
// naming vote → hatch of the successor.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redis, redisSubscriber } from "./redis/client";
import { generations } from "./db/collections";
import { PetEngine } from "./engine/engine";
import { Lifecycle } from "./engine/lifecycle";
import { caretakerProfile, recordContribution } from "./social";
import { settleTitles } from "./titles";
import { proposeName, voteForName } from "./votes";
import { startTestInfra, type TestInfra } from "./testsetup";
import type { Generation } from "@/sim/model";
import type { RoomView } from "./shop";
import { INCUBATION_TICKS, MOURNING_TICKS, TICKS_PER_DAY, TICK_SECONDS } from "@/sim/tuning";

let infra: TestInfra;
let engine: PetEngine;
let lifecycle: Lifecycle;
/** Every room announced on the bus: the family wall goes up through one (SPEC §22.10). */
const rooms: RoomView[] = [];

// Late morning in the pet's timezone so the newborn is awake.
let fakeNowMs = 1_760_028_800_000;
const advanceTicks = (ticks: number): void => {
  fakeNowMs += ticks * TICK_SECONDS * 1000;
};

beforeAll(async () => {
  infra = startTestInfra();
  const database = await db();
  engine = new PetEngine({ db: database, redis: redis(), key, timeZone: "America/Chicago", now: () => fakeNowMs });
  lifecycle = new Lifecycle(database, engine, () => fakeNowMs);
  const subscriber = redisSubscriber();
  await subscriber.subscribe(key("events"));
  subscriber.on("message", (channel, payload) => {
    if (channel !== key("events")) return;
    const message = JSON.parse(payload) as { type: string; room?: RoomView };
    if (message.type === "room" && message.room) rooms.push(message.room);
  });
}, 120_000);

/** The first room announcement that hangs `name` on the wall, within a moment. */
const wallWith = async (name: string): Promise<RoomView> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const room = rooms.find((candidate) => candidate.ancestors.some((ancestor) => ancestor.name === name));
    if (room) return room;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no room announcement hung ${name} on the wall`);
};

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("generation lifecycle", () => {
  it("runs death → seal → mourning → rebirth → vote → hatch, end to end", async () => {
    const database = await db();
    const first = await engine.ensureGeneration();

    // Birth and a little recorded care from two caretakers.
    advanceTicks(INCUBATION_TICKS);
    await proposeName(database, first.id, "ana", "Makoto");
    let state = await engine.tick(first);
    expect((await lifecycle.check(first, state)) ?? null).toBeNull(); // hatch happens inside check
    state = await engine.view(first);
    expect(state.bornAtTick).not.toBeNull();
    expect(state.generation.name).toBe("Makoto");

    advanceTicks(60);
    const fed = await engine.care(first, "FEED", "ana");
    expect(fed.ok).toBe(true);
    if (fed.ok) {
      await recordContribution(database, { caretakerId: "ana", generationId: first.id, action: "FEED", applied: fed.applied, tick: fed.state.tick });
    }
    advanceTicks(6);
    const played = await engine.care(first, "PLAY", "bo");
    expect(played.ok).toBe(true);
    if (played.ok) {
      await recordContribution(database, { caretakerId: "bo", generationId: first.id, action: "PLAY", applied: played.applied, tick: played.state.tick });
    }

    // Ana holds a title going into the grave (SPEC §24.2).
    await settleTitles(database, first.id, "ana", ["cuddler"]);

    // Total abandonment: the pet dies.
    advanceTicks(10 * TICKS_PER_DAY);
    state = await engine.tick(first);
    expect(state.diedAtTick).not.toBeNull();

    // First check seals the memorial but stays in mourning...
    let successor = await lifecycle.check(first, state);
    const stillMourning = state.tick < state.diedAtTick! + MOURNING_TICKS;
    if (stillMourning) expect(successor).toBeNull();

    const sealed = await generations(database).findOne({ _id: first.id });
    expect(sealed?.memorial).not.toBeNull();
    expect(sealed?.memorial?.ranking.map((row) => row.caretakerId).sort()).toEqual(["ana", "bo"]);
    // The final title holders are frozen in, like quirks (SPEC §24.2).
    expect(sealed?.memorial?.titles).toEqual([{ titleId: "cuddler", caretakerId: "ana", name: "Friend ana", value: 1 }]);
    expect((await caretakerProfile(database, "ana"))?.generationsSurvived).toBe(1);
    expect((await caretakerProfile(database, "bo"))?.generationsSurvived).toBe(1);
    // ...and the family wall learns of it at once, newest first (SPEC §22.10).
    const wall = await wallWith("Makoto");
    expect(wall.ancestors[0]).toEqual({ ordinal: first.ordinal, name: "Makoto" });

    // ...then mourning ends and the next egg is laid.
    advanceTicks(MOURNING_TICKS + 30);
    state = await engine.tick(first);
    successor = await lifecycle.check(first, state);
    expect(successor).not.toBeNull();
    expect(successor!.ordinal).toBe(first.ordinal + 1);

    // Rotation is idempotent under a repeated check.
    const again = await lifecycle.check(first, state);
    expect(again?.id).toBe(successor!.id);

    // The successor is an egg; without proposals it simply waits...
    const second = successor as Generation;
    advanceTicks(INCUBATION_TICKS + 60);
    let eggState = await engine.tick(second);
    expect(eggState.bornAtTick).toBeNull();
    await lifecycle.check(second, eggState);
    eggState = await engine.view(second);
    expect(eggState.bornAtTick).toBeNull();

    // ...until the community names it: most votes wins, ties to earliest.
    await proposeName(database, second.id, "ana", "Mochi");
    await proposeName(database, second.id, "bo", "Biscuit");
    await voteForName(database, second.id, "cyn", "biscuit");
    eggState = await engine.tick(second);
    await lifecycle.check(second, eggState);
    const born = await engine.view(second);
    expect(born.bornAtTick).not.toBeNull();
    expect(born.generation.name).toBe("Biscuit");
  }, 60_000);
});
