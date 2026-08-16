// The client-side game roster: which component runs each MinigameId and the
// one-line control hint under its canvas. Titles, emoji, and envelopes live
// in src/sim/minigames.ts — this file only binds ids to implementations.

import type { ComponentType } from "react";
import type { MinigameId } from "@/sim/minigames";
import type { GameProps } from "./types";
import DustDash from "./DustDash";
import SnackCatch from "./SnackCatch";
import BubblePop from "./BubblePop";
import SimonSqueaks from "./SimonSqueaks";
import WheelSprint from "./WheelSprint";

export type GameEntry = {
  Component: ComponentType<GameProps>;
  hint: string;
};

export const GAMES: Record<MinigameId, GameEntry> = {
  dustdash: { Component: DustDash, hint: "Tap, click, or press space to hop the dust bunnies!" },
  snackcatch: { Component: SnackCatch, hint: "Move with your pointer or arrow keys — catch snacks, dodge junk!" },
  bubblepop: { Component: BubblePop, hint: "Tap or click the bubbles before they float away!" },
  simon: { Component: SimonSqueaks, hint: "Watch Makoto's moves, then repeat them on the pads!" },
  wheelsprint: { Component: WheelSprint, hint: "Tap, click, or press space when the spark crosses the top!" },
};
