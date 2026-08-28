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
import MakotoShuffle from "./MakotoShuffle";
import NatsumisWatch from "./NatsumisWatch";
import CoffeeRun from "./CoffeeRun";
import SausageParty from "./SausageParty";
import DontGetSausaged from "./DontGetSausaged";

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
  shuffle: { Component: MakotoShuffle, hint: "Watch which bowl Makoto hides under, then tap it — or press 1, 2, 3!" },
  natsumi: { Component: NatsumisWatch, hint: "Hold to scurry for the treat — let go before Natsumi turns around!" },
  coffeerun: { Component: CoffeeRun, hint: "Hold to brew, let go to pour — don't be brewing when Natsumi walks in!" },
  sausageparty: { Component: SausageParty, hint: "Tap the guest who is holding up the dish you're serving!" },
  sausaged: { Component: DontGetSausaged, hint: "Do what Natsumi says, fast — hesitate and you're a sausage!" },
};
