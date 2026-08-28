"use client";

// Retro mode's persistence (SPEC §26.5). One key carries both halves of the
// state — whether the ancient code has ever been entered on this browser, and
// whether the display is currently switched on — because "found it and turned
// it off" and "never found it" have to be told apart and nothing else does.
//
// Read through `useSyncExternalStore` rather than mirrored into state by an
// effect: localStorage *is* an external store, and subscribing to it properly
// buys three things at once — no cascading render on mount, a server snapshot
// that renders the toggle away instead of mismatching on hydration, and
// cross-tab sync, since a caretaker with two tabs open owns one keepsake.

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "mgc:retro";

type Stored = "on" | "off" | null;

/** Some privacy modes throw on access; a lost keepsake is not worth a crash. */
const read = (): Stored => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
};

const listeners = new Set<() => void>();

const write = (value: Exclude<Stored, null>): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Then it lasts the session and no longer. Nothing else depends on it.
  }
  // `storage` only fires in *other* tabs, so this tab is told by hand.
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

// A string or null, so the store's identity check is a value comparison and
// there is no cached snapshot to keep — returning a fresh object here is what
// makes useSyncExternalStore loop forever.
const getSnapshot = (): Stored => read();
const getServerSnapshot = (): Stored => null;

export type Retro = {
  /** True once the code has been entered here — gates the header toggle. */
  found: boolean;
  on: boolean;
  toggle: () => void;
  /**
   * Switches the display on the first time the code is ever entered here, and
   * reports that. A no-op every time after, deliberately: once the keepsake is
   * unlocked, whether it is switched on is the caretaker's standing choice,
   * and re-entering the code must not override it. The header toggle is the
   * only thing that turns it back on.
   */
  unlock: () => boolean;
};

export const useRetro = (): Retro => {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const unlock = useCallback((): boolean => {
    const first = read() === null;
    if (first) write("on");
    return first;
  }, []);

  const toggle = useCallback((): void => {
    write(read() === "on" ? "off" : "on");
  }, []);

  return { found: value !== null, on: value === "on", toggle, unlock };
};
