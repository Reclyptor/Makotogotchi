// The play route's finish phase against real Mongo and Redis (SPEC §16.4): the
// event it appends names the game from the server-side session (SPEC §13.3),
// and the response carries what the reducer restored beside joy.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { closeDb, db } from "@/server/db/client";
import { closeRedis, key, redis } from "@/server/redis/client";
import { eventsSince } from "@/server/db/repository";
import { PetEngine } from "@/server/engine/engine";
import { CARETAKER_COOKIE, cookieFor } from "@/server/identity";
import { startTestInfra, type TestInfra } from "@/server/testsetup";
import type { Generation } from "@/sim/model";
import type { MinigameId } from "@/sim/minigames";
import { TICK_SECONDS } from "@/sim/tuning";

const live = vi.hoisted(() => ({ engine: null as unknown, generation: null as unknown }));
vi.mock("@/server/runtime", () => ({
  runtime: async () => ({ engine: live.engine, generation: async () => live.generation }),
}));

import { POST } from "./route";

const CARETAKER = "bather";

let infra: TestInfra;
let engine: PetEngine;
let generation: Generation;

// Late morning in the pet's timezone, so the hatched pet is awake.
let fakeNowMs = 1_760_028_800_000;
const advanceClockTicks = (ticks: number): void => {
  fakeNowMs += ticks * TICK_SECONDS * 1000;
};

/** Plant the session `start` would have written, then post a plausible finish. */
const finishRun = async (game: MinigameId): Promise<{ status: number; body: Record<string, unknown> }> => {
  await redis().set(
    key("minigame"),
    JSON.stringify({ caretakerId: CARETAKER, startedAtMs: Date.now() - 20_000, game }),
    "PX",
    60_000,
  );
  const request = new NextRequest("http://localhost/api/play", {
    method: "POST",
    headers: { cookie: `${CARETAKER_COOKIE}=${cookieFor(CARETAKER)}`, "content-type": "application/json" },
    // `minigame` is not part of the body schema, so a client naming a game
    // here must change nothing.
    body: JSON.stringify({ phase: "finish", score: 10, inputs: 20, minigame: "natsumi" }),
  });
  const response = await POST(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const lastCare = async () => {
  const log = await eventsSince(await db(), generation.id, -1);
  const care = log.filter((event) => event.type === "CARE");
  return care[care.length - 1];
};

beforeAll(async () => {
  infra = startTestInfra();
  engine = new PetEngine({ db: await db(), redis: redis(), key, timeZone: "America/Chicago", now: () => fakeNowMs });
  generation = await engine.ensureGeneration();
  live.engine = engine;
  live.generation = generation;
  advanceClockTicks(200);
  await engine.hatch(generation, "Makoto");
  // Long enough for hygiene to have slipped, so there is room to restore.
  advanceClockTicks(400);
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("POST /api/play finish", () => {
  it("writes the session's game onto the event and returns the hygiene applied", async () => {
    const { status, body } = await finishRun("bubblepop");
    expect(status).toBe(200);

    const event = await lastCare();
    expect(event).toMatchObject({ type: "CARE", action: "PLAY", itemId: "bubblepop", minigame: "bubblepop", performance: 90 });

    const bonus = body.bonus as { need: string; applied: number };
    expect(bonus.need).toBe("hygiene");
    expect(bonus.applied).toBeGreaterThan(0);
  });

  it("a game without a secondary effect still names itself but returns no bonus", async () => {
    advanceClockTicks(60);
    const { status, body } = await finishRun("dustdash");
    expect(status).toBe(200);
    expect(await lastCare()).toMatchObject({ itemId: "dustdash", minigame: "dustdash" });
    expect(body).not.toHaveProperty("bonus");
  });
});
