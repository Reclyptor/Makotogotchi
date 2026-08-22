// Fixed-timestep loop (SPEC §10.1): update() runs at a constant rate no
// matter the display's refresh rate, and render() runs on a cadence of its
// own — deliberately far below the display's.
//
// Two things the loop is responsible for not doing:
//
// Painting faster than the art. update() is a 10Hz fixed step, the fastest
// clip in the game is the butterfly at 130ms a frame, and the pet's own
// clips run 800–2000ms a frame. Painting a 10Hz simulation of ~1Hz sprite art
// sixty or a hundred and forty times a second is pure waste — and it is not
// free waste, because the canvas sits under a page full of
// `backdrop-filter` panels, every one of which re-blurs when the frame
// beneath it changes.
//
// Running while nobody is looking. A hidden tab stops requestAnimationFrame
// on its own, but a window that is merely unfocused — behind another window,
// on a second monitor — does not, and that is where this used to sit at a
// third of a GPU indefinitely. The loop parks itself when the document is
// hidden or the window has lost focus, and comes back on either edge.

export type LoopCallbacks = {
  update: (dtMs: number) => void;
  render: (nowMs: number) => void;
};

export const UPDATE_STEP_MS = 100;

/** How often the scene is allowed to paint — twice the rate of the fastest
 *  art in the game, which leaves the cadence invisible and the cost bounded. */
export const RENDER_STEP_MS = 1000 / 15;

const MAX_ACCUMULATED_MS = 1000;

export const startLoop = (callbacks: LoopCallbacks): (() => void) => {
  let rafId = 0;
  let last = performance.now();
  let accumulated = 0;
  // Which RENDER_STEP_MS-wide window of wall-clock time was last painted.
  // Bucketing rather than subtracting an interval is what keeps the cadence
  // honest: comparing elapsed time against the step lets the remainder pile
  // up and quietly drops the rate to the next divisor of the refresh rate.
  let lastBucket = -1;
  let disposed = false;

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

  const watched = (): boolean => document.visibilityState !== "hidden" && document.hasFocus();

  const frame = (now: number): void => {
    if (disposed) return;
    accumulated = Math.min(accumulated + (now - last), MAX_ACCUMULATED_MS);
    last = now;
    while (accumulated >= UPDATE_STEP_MS) {
      guard(() => callbacks.update(UPDATE_STEP_MS), now);
      accumulated -= UPDATE_STEP_MS;
    }

    const bucket = Math.floor(now / RENDER_STEP_MS);
    if (bucket !== lastBucket) {
      lastBucket = bucket;
      guard(() => callbacks.render(now), now);
    }

    // Parking happens after the frame, never before it. A page opened in a
    // window that never had focus still gets its room painted once — the
    // scene is there the moment it is looked at, and costs nothing until it
    // is focused.
    if (!watched()) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(frame);
  };

  const onWatchedChange = (): void => {
    if (disposed || !watched()) return;
    // Coming back from hidden or unfocused: the gap is not elapsed game time.
    // Without this reset a window left alone for an hour would replay it as a
    // burst of catch-up updates the moment it was looked at again.
    last = performance.now();
    accumulated = 0;
    // Repaint immediately rather than waiting out the cadence, so a resumed
    // window is never showing a stale room.
    lastBucket = -1;
    if (rafId === 0) rafId = requestAnimationFrame(frame);
  };

  // Only the resuming edges need a listener. Losing focus needs none: the
  // frame already in flight notices on its own and parks, one frame later at
  // the outside.
  document.addEventListener("visibilitychange", onWatchedChange);
  window.addEventListener("focus", onWatchedChange);
  rafId = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    rafId = 0;
    document.removeEventListener("visibilitychange", onWatchedChange);
    window.removeEventListener("focus", onWatchedChange);
  };
};
