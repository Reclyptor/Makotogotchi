import React, { useEffect, useRef, useState } from "react";
import Sprite from "~/components/Sprite";
import configuration from "~/resources/configuration";
import dayjs from "dayjs";

const INITIAL_STATE: Omit<State, 'born'> = {
  hunger: 0,
  happiness: 100,
  sick: false,
  sleeping: false,
} as const;

export type State = {
  born: Date;
  hunger: number;
  happiness: number;
  sick: boolean;
  sleeping: boolean;
};

export enum Action {
  PET,
  EAT,
  PLAY,
  SLEEP,
  WAKE,
  CURE,
}

export const reduce = (state: State, action?: Action): State => {
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

export const sequenceOf = (state: State): keyof typeof configuration.sequences => {
  if (dayjs().diff(state.born, "minute") < 1) return "clonePhase1";
  if (dayjs().diff(state.born, "minute") < 2) return "clonePhase2";
  if (dayjs().diff(state.born, "minute") < 3) return "clonePhase3";
  if (dayjs().diff(state.born, "minute") < 4) return "clonePhase4";
  if (state.sick) return "sick";
  if (state.sleeping) return "sleeping";
  if (state.hunger >= 50) return "hungry";
  if (state.happiness <= 50) return "walking";
  if (state.happiness <= 25) return "tired";
  if (state.happiness <= 10) return "dead";
  return "idle";
};

export type MakotoProps = {
  state?: State;
};

const Makoto = (props: MakotoProps) => {
  const [state, setState] = useState<State>(props.state || { ...INITIAL_STATE, born: new Date(Date.now()) });
  const [sequence, setSequence] = useState<keyof typeof configuration.sequences>(sequenceOf(state));
  const timeout = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timeout.current = setInterval(() => {
      const newState = reduce(state);
      const newSequence = sequenceOf(newState);
      setState(newState);
      setSequence(newSequence);
    }, 1000);
    return () => { timeout.current && clearInterval(timeout.current); };
  }, [state]);

  return (
    <Sprite { ...configuration } sequence={ sequence } />
  );
};

export default Makoto;