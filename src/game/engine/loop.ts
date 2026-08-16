// Fixed-timestep loop (SPEC §10.1): update() runs at a constant rate no
// matter the display's refresh rate; render() runs once per animation frame.
// Hidden tabs pause entirely — requestAnimationFrame stops on its own, and
// the visibility handler resets the accumulator so a background hour does
// not replay as a thousand catch-up updates.

export type LoopCallbacks = {
  update: (dtMs: number) => void;
  render: (nowMs: number) => void;
};

export const UPDATE_STEP_MS = 100;
const MAX_ACCUMULATED_MS = 1000;

export const startLoop = (callbacks: LoopCallbacks): (() => void) => {
  let rafId = 0;
  let last = performance.now();
  let accumulated = 0;
  let running = true;

  // One throwing frame must never kill the loop: the exception would escape
  // the rAF callback, the next frame would never be requested, and the scene
  // would freeze on whatever was painted mid-frame. Log and keep going.
  let lastErrorLogMs = 0;
  const guard = (fn: () => void, now: number): void => {
    try {
      fn();
    } catch (error) {
      if (now - lastErrorLogMs > 5000) {
        lastErrorLogMs = now;
        console.error("game loop frame failed", error);
      }
    }
  };

  const frame = (now: number): void => {
    if (!running) return;
    accumulated = Math.min(accumulated + (now - last), MAX_ACCUMULATED_MS);
    last = now;
    while (accumulated >= UPDATE_STEP_MS) {
      guard(() => callbacks.update(UPDATE_STEP_MS), now);
      accumulated -= UPDATE_STEP_MS;
    }
    guard(() => callbacks.render(now), now);
    rafId = requestAnimationFrame(frame);
  };

  const onVisibility = (): void => {
    if (!document.hidden) {
      last = performance.now();
      accumulated = 0;
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  rafId = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    document.removeEventListener("visibilitychange", onVisibility);
  };
};
