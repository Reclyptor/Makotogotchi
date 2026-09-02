// The reconciliation cycle's whole reason to exist is that its cost does not
// scale with the audience (SPEC §7.4). That is what these assert: one
// production per cycle however many streams are attached, the same bytes to
// all of them, and nothing running at all once the last one leaves.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnapshotFanout } from "./snapshots";

const INTERVAL = 30_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advance one cycle and let the producer's promise settle. */
const cycle = async (times = 1): Promise<void> => {
  for (let index = 0; index < times; index++) {
    await vi.advanceTimersByTimeAsync(INTERVAL);
  }
};

describe("the snapshot fanout", () => {
  it("produces once per cycle no matter how many streams are watching", async () => {
    let produced = 0;
    const fanout = new SnapshotFanout(async () => `payload-${++produced}`, INTERVAL);

    const seen = [0, 0, 0].map(() => [] as string[]);
    const off = seen.map((sink) => fanout.subscribe((data) => sink.push(data)));

    await cycle(2);

    // Three streams, two cycles: two payloads, not six.
    expect(produced).toBe(2);
    for (const sink of seen) expect(sink).toEqual(["payload-1", "payload-2"]);

    off.forEach((stop) => stop());
  });

  it("hands every stream the identical serialized payload", async () => {
    const fanout = new SnapshotFanout(async () => JSON.stringify({ tick: 42 }), INTERVAL);
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = fanout.subscribe((data) => first.push(data));
    const offSecond = fanout.subscribe((data) => second.push(data));

    await cycle();

    expect(first).toHaveLength(1);
    // Same string instance: serialized once, sent to both.
    expect(first[0]).toBe(second[0]);

    offFirst();
    offSecond();
  });

  it("stops producing once the last stream leaves, and resumes for the next", async () => {
    let produced = 0;
    const fanout = new SnapshotFanout(async () => `payload-${++produced}`, INTERVAL);

    const off = fanout.subscribe(() => {});
    await cycle();
    expect(produced).toBe(1);

    off();
    await cycle(3);
    // An idle pod costs nothing.
    expect(produced).toBe(1);

    const again = fanout.subscribe(() => {});
    await cycle();
    expect(produced).toBe(2);
    again();
  });

  it("keeps the cycle alive when one production fails", async () => {
    let attempt = 0;
    const fanout = new SnapshotFanout(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("redis went away");
      return `payload-${attempt}`;
    }, INTERVAL);

    const seen: string[] = [];
    const off = fanout.subscribe((data) => seen.push(data));

    await cycle(2);

    // The failed cycle is skipped, not fatal: the next one catches everyone
    // up, which is exactly what the per-client timers used to do.
    expect(attempt).toBe(2);
    expect(seen).toEqual(["payload-2"]);

    off();
  });

  it("delivers nothing to a stream that has already unsubscribed", async () => {
    const fanout = new SnapshotFanout(async () => "payload", INTERVAL);
    const stale: string[] = [];
    const live: string[] = [];
    const offStale = fanout.subscribe((data) => stale.push(data));
    const offLive = fanout.subscribe((data) => live.push(data));

    offStale();
    await cycle();

    expect(stale).toEqual([]);
    expect(live).toEqual(["payload"]);
    offLive();
  });
});
