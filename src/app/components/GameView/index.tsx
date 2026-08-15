"use client";

// The game screen shell: owns the stream connection and composes the scene.
// Phase 5 grows this into the full UI — meters, action buttons, the live
// feed; for now it proves the pet visibly lives (SPEC §20, Phase 4).

import PetCanvas from "@/app/components/PetCanvas";
import { usePetStream } from "@/app/hooks/usePetStream";

export default function GameView() {
  const stream = usePetStream();

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-4">
      <header className="flex w-full items-center justify-between text-sm text-muted">
        <span>{stream.connected ? "● live" : "○ connecting…"}</span>
        <span aria-live="polite">
          👥 {stream.presenceCount} watching
        </span>
      </header>
      <PetCanvas stream={stream} />
    </div>
  );
}
