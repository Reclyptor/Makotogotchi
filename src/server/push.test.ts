// Push dispatcher decision logic against real stores, with the network
// sender replaced by a spy (SPEC §12): fires once, throttles per caretaker,
// re-arms only after held recovery, prunes dead endpoints.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redis } from "./redis/client";
import { PushDispatcher, type PushPayload } from "./push/dispatcher";
import { allSubscriptions, saveSubscription } from "./push/store";
import { startTestInfra, type TestInfra } from "./testsetup";
import { genesis } from "@/sim/genesis";
import type { PetState } from "@/sim/model";
import { CRITICAL_THRESHOLD, HEALTH_MAX, NEED_MAX } from "@/sim/tuning";

let infra: TestInfra;
let fakeNowMs = 1_760_028_800_000;

type Sent = { endpoint: string; payload: PushPayload };
const sent: Sent[] = [];
const deadEndpoints = new Set<string>();

const spySender = async (subscription: { endpoint: string }, payload: PushPayload): Promise<void> => {
  if (deadEndpoints.has(subscription.endpoint)) {
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  }
  sent.push({ endpoint: subscription.endpoint, payload });
};

let dispatcher: PushDispatcher;

const petState = (overrides: Partial<PetState>): PetState => ({
  ...genesis({ id: "gen-push", ordinal: 1, seed: 1, genesisEpochMs: fakeNowMs, name: "Makoto" }),
  bornAtTick: 0,
  tick: 10_000,
  ...overrides,
});

beforeAll(async () => {
  infra = startTestInfra();
  const database = await db();
  dispatcher = new PushDispatcher(database, redis(), key, spySender as never, () => fakeNowMs);
  await saveSubscription(database, "ct-a", { endpoint: "https://push.example/a", keys: { p256dh: "k", auth: "a" } });
  await saveSubscription(database, "ct-b", { endpoint: "https://push.example/b", keys: { p256dh: "k", auth: "a" } });
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("PushDispatcher", () => {
  it("fires sickness once and does not repeat while it persists", async () => {
    sent.length = 0;
    const sickState = petState({ sick: true, sickSinceTick: 9_000 });
    await dispatcher.observe(sickState);
    expect(sent.filter((s) => s.payload.tag === "sick")).toHaveLength(2); // both caretakers
    await dispatcher.observe(sickState);
    await dispatcher.observe(sickState);
    expect(sent.filter((s) => s.payload.tag === "sick")).toHaveLength(2); // still just once each
  });

  it("throttles a caretaker across different triggers within 30 minutes", async () => {
    sent.length = 0;
    const starving = petState({ sick: true, sickSinceTick: 9_000, needs: { hunger: 50_000, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX } });
    await dispatcher.observe(starving);
    // The hunger-critical trigger fires, but both caretakers were throttled
    // by the sickness push moments ago.
    expect(sent).toHaveLength(0);
  });

  it("re-arms a trigger only after recovery held for 30 minutes", async () => {
    sent.length = 0;
    fakeNowMs += 31 * 60 * 1000; // clear the caretaker throttle

    const healthy = petState({ sick: false });
    await dispatcher.observe(healthy); // recovery observed — streak starts
    const sickAgain = petState({ sick: true, sickSinceTick: 12_000 });
    await dispatcher.observe(sickAgain);
    // Re-arm hold not satisfied: recovery streak was reset by relapse.
    expect(sent.filter((s) => s.payload.tag === "sick")).toHaveLength(0);

    fakeNowMs += 31 * 60 * 1000;
    await dispatcher.observe(petState({ sick: false })); // streak starts
    fakeNowMs += 31 * 60 * 1000;
    await dispatcher.observe(petState({ sick: false })); // streak satisfied → re-armed
    await dispatcher.observe(petState({ sick: true, sickSinceTick: 20_000 }));
    expect(sent.filter((s) => s.payload.tag === "sick")).toHaveLength(2);
  });

  it("prunes endpoints the push service reports gone", async () => {
    sent.length = 0;
    fakeNowMs += 31 * 60 * 1000;
    deadEndpoints.add("https://push.example/b");

    const dying = petState({ healthRaw: HEALTH_MAX / 10 });
    await dispatcher.observe(dying);
    expect(sent.filter((s) => s.payload.tag === "health").map((s) => s.endpoint)).toEqual(["https://push.example/a"]);

    const remaining = await allSubscriptions(await db());
    expect(remaining.map((s) => s.endpoint)).toEqual(["https://push.example/a"]);
  });

  it("critical-need triggers respect the crossing threshold", async () => {
    sent.length = 0;
    fakeNowMs += 31 * 60 * 1000;
    const low = petState({ needs: { hunger: CRITICAL_THRESHOLD - 1, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX } });
    await dispatcher.observe(low);
    expect(sent.some((s) => s.payload.tag === "critical-hunger")).toBe(true);
  });
});

describe("the playful want lane (SPEC §25.6)", () => {
  const wanting = (window: number): PetState => petState({ wantOpen: { window, kind: "cuddle" } });
  const wantsSent = (): Sent[] => sent.filter((s) => s.payload.tag === "want");

  it("fires into an empty room, once per window", async () => {
    sent.length = 0;
    fakeNowMs += 25 * 60 * 60 * 1000; // clear every earlier throttle
    await dispatcher.observe(wanting(100));
    expect(wantsSent()).toHaveLength(1);
    await dispatcher.observe(wanting(100));
    expect(wantsSent()).toHaveLength(1); // window already claimed
  });

  it("stays silent while anyone is watching — and still fires when the room empties", async () => {
    sent.length = 0;
    fakeNowMs += 5 * 60 * 60 * 1000;
    await redis().zadd(key("presence"), String(Date.now()), "ct-x|conn-1");
    await dispatcher.observe(wanting(101));
    expect(wantsSent()).toHaveLength(0);
    // The viewer leaves mid-window; the once-key was never claimed.
    await redis().zremrangebyscore(key("presence"), "-inf", "+inf");
    await dispatcher.observe(wanting(101));
    expect(wantsSent()).toHaveLength(1);
  });

  it("defers to a recent urgent push but never blocks one", async () => {
    sent.length = 0;
    fakeNowMs += 5 * 60 * 60 * 1000;
    // An urgent alert lands first…
    await dispatcher.observe(petState({ sick: true, sickSinceTick: 9_000, generation: { ...petState({}).generation, id: "gen-push-2" } }));
    expect(sent.filter((s) => s.payload.tag === "sick")).toHaveLength(1);
    // …so the want defers for the urgent throttle's span.
    await dispatcher.observe(wanting(102));
    expect(wantsSent()).toHaveLength(0);

    // Past the urgent window, the want goes out (the window key was
    // consumed above — a fresh window asks again).
    fakeNowMs += 31 * 60 * 1000;
    await dispatcher.observe(wanting(103));
    expect(wantsSent()).toHaveLength(1);

    // And a playful send never consumes the urgent lane: a critical alert
    // moments later still delivers.
    const dying = petState({
      healthRaw: HEALTH_MAX / 10,
      generation: { ...petState({}).generation, id: "gen-push-3" },
    });
    await dispatcher.observe(dying);
    expect(sent.filter((s) => s.payload.tag === "health")).toHaveLength(1);
  });

  it("throttles playful pushes to one per four hours per caretaker", async () => {
    sent.length = 0;
    // The last want push above set the playful throttle; a new window
    // within four hours stays quiet.
    fakeNowMs += 60 * 60 * 1000;
    await dispatcher.observe(wanting(104));
    expect(wantsSent()).toHaveLength(0);
    fakeNowMs += 4 * 60 * 60 * 1000;
    await dispatcher.observe(wanting(105));
    expect(wantsSent()).toHaveLength(1);
  });
});
