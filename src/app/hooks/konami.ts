// The ancient code (SPEC §26.1), as a pure matcher. The DOM half lives in
// useKonami.ts; keeping the sequence logic here is what lets it be tested
// without a browser, and the sequence logic is where all the subtlety is.

export const KONAMI_SEQUENCE = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
  "enter",
] as const;

/**
 * A rolling window over the last `KONAMI_SEQUENCE.length` keys.
 *
 * Deliberately not an advance-or-reset index. That shape gets overlapping
 * prefixes wrong — the classic failure is `↑↑↑↓↓…`, where the third `↑`
 * should leave the matcher one key in rather than back at the start, and
 * every fix for it re-derives a rolling window badly. Comparing eleven
 * strings on keydown is free, so the window is kept literally.
 */
export class KonamiMatcher {
  private readonly recent: string[] = [];

  /** Feeds one key. True on the press that completes the sequence. */
  push(key: string): boolean {
    this.recent.push(key.toLowerCase());
    if (this.recent.length > KONAMI_SEQUENCE.length) this.recent.shift();
    if (this.recent.length < KONAMI_SEQUENCE.length) return false;
    return KONAMI_SEQUENCE.every((expected, index) => this.recent[index] === expected);
  }

  /** Drops the window — used when the listener is disarmed mid-sequence. */
  reset(): void {
    this.recent.length = 0;
  }
}
