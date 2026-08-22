// The loop's two jobs beyond running: painting on a cadence of its own, and
// not running at all while nobody is looking. Both are driven by browser
// globals, so the test installs a controllable stand-in for each rather than
// reaching for a DOM implementation — the same approach room.test.ts takes to
// the canvas context.

import { afterEach, describe, expect, it, vi } from "vitest";
import { RENDER_STEP_MS, UPDATE_STEP_MS, startLoop } from "./loop";

/** A hand-driven rAF: frames advance only when the test says so. */
const harness = () => {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, (time: number) => void>();
  const listeners = new Map<string, Set<() => void>>();

  const on = (target: "document" | "window", type: string, fn: () => void): void => {
    const key = `${target}:${type}`;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
  };
  const off = (target: "document" | "window", type: string, fn: () => void): void => {
    listeners.get(`${target}:${type}`)?.delete(fn);
  };

  const state = { visibilityState: "visible" as DocumentVisibilityState, focused: true };

  const globals = {
    performance: { now: () => now },
    requestAnimationFrame: (callback: (time: number) => void): number => {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number): void => {
      pending.delete(id);
    },
    document: {
      get visibilityState() {
        return state.visibilityState;
      },
      hasFocus: () => state.focused,
      addEventListener: (type: string, fn: () => void) => on("document", type, fn),
      removeEventListener: (type: string, fn: () => void) => off("document", type, fn),
    },
    window: {
      addEventListener: (type: string, fn: () => void) => on("window", type, fn),
      removeEventListener: (type: string, fn: () => void) => off("window", type, fn),
    },
  };
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value);

  return {
    /** Run every frame the loop has asked for, advancing the clock by `stepMs`. */
    advance(stepMs: number, frames: number): void {
      for (let i = 0; i < frames; i++) {
        now += stepMs;
        const due = [...pending.entries()];
        pending.clear();
        for (const [, callback] of due) callback(now);
      }
    },
    get scheduled(): number {
      return pending.size;
    },
    get listenerCount(): number {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
    blur(): void {
      state.focused = false;
    },
    focus(): void {
      state.focused = true;
      for (const fn of listeners.get("window:focus") ?? []) fn();
    },
    hide(): void {
      state.visibilityState = "hidden";
      for (const fn of listeners.get("document:visibilitychange") ?? []) fn();
    },
    show(): void {
      state.visibilityState = "visible";
      for (const fn of listeners.get("document:visibilitychange") ?? []) fn();
    },
  };
};

const counters = () => {
  const calls = { update: 0, render: 0 };
  return {
    calls,
    callbacks: {
      update: () => {
        calls.update += 1;
      },
      render: () => {
        calls.render += 1;
      },
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("render cadence", () => {
  it("paints on its own schedule, not the display's", () => {
    const stage = harness();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    // Two seconds of a 144Hz display.
    stage.advance(1000 / 144, 288);
    stop();

    // 15fps over two seconds, and the opening frame paints immediately.
    expect(calls.render).toBeGreaterThanOrEqual(30);
    expect(calls.render).toBeLessThanOrEqual(32);
  });

  it("holds the same cadence on a slower display", () => {
    const stage = harness();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    stage.advance(1000 / 60, 120); // two seconds at 60Hz
    stop();

    // A remainder-accumulating check would drop to 12fps here; bucketing does
    // not, which is the whole reason the loop counts buckets.
    expect(calls.render).toBeGreaterThanOrEqual(30);
    expect(calls.render).toBeLessThanOrEqual(32);
  });

  it("keeps update on its fixed step regardless of the render cadence", () => {
    const stage = harness();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    // 20ms is exactly representable, so the accumulator telescopes to a whole
    // second and the count is not a float-drift coin toss.
    stage.advance(20, 50);
    stop();

    expect(calls.update).toBe(1000 / UPDATE_STEP_MS);
  });

  it("renders far less often than it updates", () => {
    expect(RENDER_STEP_MS).toBeLessThan(UPDATE_STEP_MS);
    expect(RENDER_STEP_MS).toBeGreaterThan(1000 / 30);
  });
});

describe("parking while nobody is looking", () => {
  it("paints once before parking, so an unfocused window still has a room in it", () => {
    const stage = harness();
    stage.blur();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    stage.advance(1000 / 60, 60);

    expect(calls.render).toBe(1);
    expect(stage.scheduled).toBe(0);
    stop();
  });

  it("stops asking for frames once the window loses focus", () => {
    const stage = harness();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    stage.advance(1000 / 60, 30);
    const painted = calls.render;
    expect(stage.scheduled).toBe(1);

    stage.blur();
    stage.advance(1000 / 60, 60);

    // The frame already in flight finishes, then the loop parks.
    expect(calls.render).toBeLessThanOrEqual(painted + 1);
    expect(stage.scheduled).toBe(0);
    stop();
  });

  it("comes back on focus and repaints at once rather than waiting out the cadence", () => {
    const stage = harness();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    stage.advance(1000 / 60, 30);
    stage.blur();
    stage.advance(1000 / 60, 10);
    const parked = calls.render;

    stage.focus();
    stage.advance(1, 1); // a single millisecond, far inside one render step

    expect(calls.render).toBe(parked + 1);
    stop();
  });

  it("does not replay a long absence as a burst of catch-up updates", () => {
    const stage = harness();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    stage.advance(1000 / 60, 6);
    stage.hide();
    const before = calls.update;

    // An hour goes by with the tab hidden and no frames delivered.
    stage.advance(3_600_000, 0);
    stage.show();
    stage.advance(1000 / 60, 1);

    expect(calls.update - before).toBe(0);
    stop();
  });

  it("releases every listener it took", () => {
    const stage = harness();
    const { callbacks } = counters();
    const stop = startLoop(callbacks);

    expect(stage.listenerCount).toBeGreaterThan(0);
    stop();
    expect(stage.listenerCount).toBe(0);
    expect(stage.scheduled).toBe(0);
  });

  it("draws nothing more after it is stopped", () => {
    const stage = harness();
    const { calls, callbacks } = counters();
    const stop = startLoop(callbacks);

    stage.advance(1000 / 60, 30);
    stop();
    const painted = calls.render;
    stage.advance(1000 / 60, 60);

    expect(calls.render).toBe(painted);
  });
});
