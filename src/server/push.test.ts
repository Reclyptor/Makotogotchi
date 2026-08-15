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
