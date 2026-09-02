// Per-process setup that must happen exactly once: opening the Mongo
// connection, declaring a collection's indexes.
//
// The obvious shape for this is a boolean set after the await:
//
//   let done = false;
//   if (done) return;
//   await work();
//   done = true;
//
// which does not do what it looks like. Every caller arriving while the first
// is still in flight reads `done === false` and starts the work again, so a
// cold process fires the setup once per concurrent caller rather than once.
// Index creation survived that because `createIndex` is idempotent — which is
// exactly why nobody noticed — but the same shape in front of a connection is
// how a pool ends up with several.
//
// Caching the PROMISE closes the window: latecomers await the work already
// running. A rejection is deliberately not cached, so a store that happened to
// be down at boot does not leave the process permanently convinced its setup
// is impossible.

export type Once<T, A> = ((arg: A) => Promise<T>) & {
  /**
   * The work already running or finished, or null if it never started.
   * Lets a teardown close what was opened without opening it to find out.
   */
  peek: () => Promise<T> | null;
  /** Forget the result, successful or not. For tests, and for shutdown. */
  reset: () => void;
};

export const once = <T, A = void>(work: (arg: A) => Promise<T>): Once<T, A> => {
  let inFlight: Promise<T> | null = null;

  const run = (arg: A): Promise<T> => {
    if (inFlight) return inFlight;
    const attempt = work(arg);
    inFlight = attempt;
    attempt.catch(() => {
      // Only clear our own attempt: a later caller may already have started a
      // fresh one, and forgetting that would defeat the whole point.
      if (inFlight === attempt) inFlight = null;
    });
    return attempt;
  };

  run.peek = (): Promise<T> | null => inFlight;

  run.reset = (): void => {
    inFlight = null;
  };

  return run;
};
