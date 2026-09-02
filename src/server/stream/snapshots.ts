// The 30s reconciliation snapshot (SPEC §7.4), computed once per pod.
//
// Nothing in that payload belongs to the caller: state, derived view, clock
// alignment, phase schedule and room are all generation-scoped, and every
// open stream is handed byte-identical JSON. Producing it on a per-client
// timer therefore multiplied one Redis read, one projection, one phase
// schedule, one derive and one JSON encode by the number of watchers — a
// thousand streams paid for a thousand identical answers, on a timer,
// forever. The cost of reconciliation should scale with the pet, which there
// is one of, not with the audience.
//
// So: one ticker per process, one payload per cycle, serialized once and
// pushed to every local subscriber. This is the hub's shape (one Redis
// subscription for a thousand clients) applied to the other half of the
// stream — the half the hub never covered, because these messages are
// produced here rather than received.

type Listener = (data: string) => void;

/**
 * A snapshot cycle, driven by whatever the caller knows how to produce.
 *
 * The producer is injected rather than imported so this module stays clear of
 * the runtime singleton that would import it back.
 */
export class SnapshotFanout {
  private readonly listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly produce: () => Promise<string>,
    private readonly intervalMs: number,
  ) {}

  /** Attach a stream. The ticker runs only while somebody is listening. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
      // The last watcher left: stop computing snapshots nobody will read.
      // An idle pod behind a load balancer should cost nothing, and the
      // ticker comes back with the next connection.
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** For shutdown, and for tests. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.emit().catch(() => {
        // A transient store error skips one reconciliation cycle, exactly as
        // it did per-client: the next cycle, or the live event flow, catches
        // every client up. It must not tear the ticker down for the others.
      });
    }, this.intervalMs);
    // Never hold the process open for a reconciliation.
    this.timer.unref?.();
  }

  private async emit(): Promise<void> {
    if (this.listeners.size === 0) return;
    const data = await this.produce();
    for (const listener of this.listeners) listener(data);
  }
}

// One fanout per process, on globalThis for the reason the hub is: a dev-mode
// module reload must reuse the running ticker rather than stack a second one.
const GLOBAL_KEY = Symbol.for("makotogotchi.snapshotfanout");
type GlobalWithFanout = typeof globalThis & { [GLOBAL_KEY]?: SnapshotFanout };

export const snapshotFanout = (produce: () => Promise<string>, intervalMs: number): SnapshotFanout => {
  const holder = globalThis as GlobalWithFanout;
  holder[GLOBAL_KEY] ??= new SnapshotFanout(produce, intervalMs);
  return holder[GLOBAL_KEY];
};
