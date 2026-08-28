"use client";

// The DOM half of the ancient code (SPEC §26.1). The matcher it drives is
// pure and lives next door; everything here is about *when* the room is
// listening at all.

import { useEffect, useRef } from "react";
import { KonamiMatcher } from "./konami";

/** True for keystrokes that belong to something the caretaker is typing in. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/**
 * Watches for the ancient code and calls `onFound` once per completed entry.
 *
 * `enabled` is not a nicety. Four of the five minigames bind arrow keys and
 * the shop is a modal, so a live dialog owns the keyboard and the code must
 * be genuinely inert rather than merely unlikely to complete — the window is
 * dropped on the way out, so a half-entered sequence cannot survive a game
 * and finish itself afterwards.
 */
export const useKonami = (onFound: () => void, enabled: boolean): void => {
  // Held in a ref so a changing callback does not re-bind the listener and
  // silently discard a sequence in progress.
  const found = useRef(onFound);
  useEffect(() => {
    found.current = onFound;
  }, [onFound]);

  useEffect(() => {
    if (!enabled) return;
    const matcher = new KonamiMatcher();

    const onKeyDown = (event: KeyboardEvent): void => {
      // Holding a key down is one press, not eleven.
      if (event.repeat) return;
      // `a` and `b` are letters; the nickname editor is a text field.
      if (isTyping(event.target)) return;
      if (!matcher.push(event.key)) return;
      // Nothing is preventDefault-ed speculatively: swallowing arrow keys
      // would break page scrolling for every visitor in order to catch a
      // secret almost none of them are typing. The completing press is the
      // exception — at this point the sequence is known to be the code, so
      // consuming it is justified, and it stops the Enter from also
      // activating whichever action button happened to hold focus.
      event.preventDefault();
      found.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
};
