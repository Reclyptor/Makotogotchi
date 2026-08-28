"use client";

// Retro display (SPEC §26.5), the ancient code's keepsake. Rendered from the
// root layout so it covers the whole app — the memorial and the leaderboard
// are inside the television too, not just the room.
//
// Decorative only: it carries no information the DOM does not already have,
// so it is aria-hidden and inert to the pointer. The state it reads is the
// same external store the header toggle writes, so the two cannot disagree
// and a second tab follows along.

import { useRetro } from "@/app/hooks/useRetro";

export default function RetroOverlay() {
  const retro = useRetro();
  if (!retro.on) return null;
  return <div className="retro" aria-hidden="true" />;
}
