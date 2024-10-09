import React, { useState } from "react";
import Sprite from "~/components/Sprite";
import configuration from "~/resources/configuration";
import dayjs from "dayjs";
import { MakotoState } from "~/types/makoto";

export enum Action {
  PET,
  EAT,
  PLAY,
  SLEEP,
  WAKE,
  CURE,
}

export const reduce = (state: MakotoState, action?: Action): MakotoState => {
  switch (action) {
    case Action.PET:
      return { ...state, happiness: Math.min(state.happiness + 10, 100) };
    case Action.EAT:
      return { ...state, hunger: Math.max(state.hunger - 10, 0) };
    case Action.PLAY:
      return { ...state, happiness: Math.min(state.happiness + 20, 100) };
    case Action.SLEEP:
      return { ...state, sleeping: true };
    case Action.WAKE:
      return { ...state, sleeping: false };
    case Action.CURE:
      return { ...state, sick: false };
    default:
      return { ...state };
  }
};

export const sequenceOf = (state: MakotoState): keyof typeof configuration.sequences => {
  if (dayjs().diff(state.born, "minute") < 1) return "clonePhase1";
  if (dayjs().diff(state.born, "minute") < 2) return "clonePhase2";
  if (dayjs().diff(state.born, "minute") < 3) return "clonePhase3";
  if (dayjs().diff(state.born, "minute") < 4) return "clonePhase4";
  return "idle";
};

export type MakotoProps = {
  initialState: MakotoState;
};

const Makoto = (props: MakotoProps) => {
  const [state, setState] = useState<MakotoState>(props.initialState);

  return (
    <Sprite { ...configuration } sequence={ sequenceOf(state) } />
  );
};

export default Makoto;