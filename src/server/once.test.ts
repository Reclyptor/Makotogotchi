// Seven call sites depend on these semantics — every index guard plus the
// Mongo connection — so they are pinned rather than assumed. The first two
// are the whole reason this exists: concurrent callers must share one run,
// and a failure must not be remembered as an answer.

import { describe, expect, it } from "vitest";
import { once } from "./once";

/** A promise the test resolves by hand, so "still in flight" is a real state. */
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("once", () => {
  it("runs the work a single time for callers that arrive together", async () => {
    const gate = deferred<string>();
    let runs = 0;
    const setup = once(async () => {
      runs += 1;
      return gate.promise;
    });

    // All three arrive while the first is still in flight — the exact window
    // a boolean set after the await leaves open.
    const waiting = [setup(), setup(), setup()];
    expect(runs).toBe(1);

    gate.resolve("ready");
    expect(await Promise.all(waiting)).toEqual(["ready", "ready", "ready"]);
    expect(runs).toBe(1);

    await setup();
    expect(runs).toBe(1);
  });

  it("forgets a failure so the next caller retries", async () => {
    let attempts = 0;
    const setup = once(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("the store was down at boot");
      return "ready";
    });

    await expect(setup()).rejects.toThrow("the store was down at boot");
    // A process that started while Mongo was restarting must not spend the
    // rest of its life convinced its setup is impossible.
    expect(await setup()).toBe("ready");
    expect(attempts).toBe(2);
  });

  it("gives every concurrent caller the same rejection, then retries once", async () => {
    const gate = deferred<string>();
    let attempts = 0;
    const setup = once(async () => {
      attempts += 1;
      return gate.promise;
    });

    const waiting = [setup().catch((error: Error) => error.message), setup().catch((error: Error) => error.message)];
    gate.reject(new Error("connection refused"));
    expect(await Promise.all(waiting)).toEqual(["connection refused", "connection refused"]);
    expect(attempts).toBe(1);

    // And the failure is not sticky.
    const second = once(async () => "ready");
    expect(await second()).toBe("ready");
  });

  it("passes the first caller's argument and ignores later ones", async () => {
    const seen: string[] = [];
    const setup = once(async (label: string) => {
      seen.push(label);
      return label;
    });

    expect(await setup("first")).toBe("first");
    // The index guards are all called with the same process-wide database, so
    // later arguments are not a different request — they are the same one.
    expect(await setup("second")).toBe("first");
    expect(seen).toEqual(["first"]);
  });

  it("peeks without starting the work, and reset makes it runnable again", async () => {
    let runs = 0;
    const setup = once(async () => {
      runs += 1;
      return "ready";
    });

    // A teardown must not open a connection in order to close it.
    expect(setup.peek()).toBeNull();
    expect(runs).toBe(0);

    await setup();
    expect(setup.peek()).not.toBeNull();

    setup.reset();
    expect(setup.peek()).toBeNull();
    await setup();
    expect(runs).toBe(2);
  });
});
