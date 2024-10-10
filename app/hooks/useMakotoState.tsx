import { v4 as uuidv4 } from "uuid";
import { useEffect, useRef, useState } from "react";
import { probability } from "~/util/probability";

const TICK_INTERVAL = 1000 as const;
const SAVE_INTERVAL = 60 as const;

export enum Effect {
  SICK = "SICK",
  TIRED = "TIRED",
  DIRTY = "DIRTY",
  ANGRY = "ANGRY",
}

export enum Status {
  DEAD = "DEAD",
  CLONE1 = "CLONE1",
  CLONE2 = "CLONE2",
  CLONE3 = "CLONE3",
  CLONE4 = "CLONE4",
  IDLE = "IDLE",
  EATING = "EATING",
  PLAYING = "PLAYING",
  BATHING = "BATHING",
  SLEEPING = "SLEEPING",
}

export type MakotoState = {
  _id: string;
  born: Date;
  age: number;
  awake: number;
  asleep: number;
  neglect: number;
  happiness: number;
  energy: number;
  effects: readonly Effect[];
  status: Status;
};

export enum MakotoAction {
  FEED = "FEED",
  SLEEP = "SLEEP",
  PLAY = "PLAY",
  MEDICATE = "MEDICATE",
  BATHE = "BATHE",
  PET = "PET"
}

const reduce = (state: MakotoState, action: MakotoAction): MakotoState => {
  if (state.status === Status.DEAD) return state;
  if (!isBorn(state)) return state;
  switch (action) {
    case MakotoAction.FEED:
      return {
        ...state,
        neglect: 0,
        energy: Math.min(Math.max(state.energy + 10, 0), 100)
      };
    case MakotoAction.SLEEP:
      return !hasEffect(state, Effect.TIRED) ? state : {
        ...state,
        neglect: 0,
        status: Status.SLEEPING
      };
    case MakotoAction.PLAY:
      return {
        ...state,
        neglect: 0,
        happiness: Math.min(Math.max(state.happiness + 10, 0), 100),
        status: state.status === Status.PLAYING ? Status.IDLE : Status.PLAYING
      };
    case MakotoAction.MEDICATE:
      return {
        ...state,
        neglect: 0,
        effects: state.effects.filter(effect => effect !== Effect.SICK)
      };
    case MakotoAction.BATHE:
      return {
        ...state,
        neglect: 0,
        effects: state.effects.filter(effect => effect !== Effect.DIRTY)
      };
    case MakotoAction.PET:
      return {
        ...state,
        neglect: 0,
        happiness: Math.min(Math.max(state.happiness + 10, 0), 100),
        effects: state.effects.filter(effect => effect !== Effect.ANGRY)
      };
    default:
      return state;
  }
};

const status = (state: MakotoState): Status => {
  if (state.age < 60) return Status.CLONE1;
  if (state.age < 120) return Status.CLONE2;
  if (state.age < 180) return Status.CLONE3;
  if (state.age < 240) return Status.CLONE4;
  if (state.neglect >= 100) return Status.DEAD;
  if (state.status === Status.SLEEPING) return state.asleep >= 60 ? Status.IDLE : Status.SLEEPING;
  if (state.status === Status.PLAYING) return Status.PLAYING;
  if (state.status === Status.BATHING) return Status.BATHING;
  if (state.status === Status.EATING) return Status.EATING;
  return Status.IDLE;
};

const isBorn = (state: MakotoState): boolean => state.age >= 240;

const hasEffect = (state: MakotoState, effect: Effect): boolean => state.effects.includes(effect);

const tick = (state: MakotoState): MakotoState => {
  return {
    _id: state._id,
    born: state.born,
    age: state.status === Status.DEAD ? state.age : state.age + 1,
    awake: (!isBorn(state) || state.status === Status.SLEEPING) ? 0 : state.awake + 1,
    asleep: (isBorn(state) && state.status !== Status.SLEEPING) ? 0 : state.asleep + 1,
    neglect: (!isBorn(state) || state.status === Status.SLEEPING) ? state.neglect : Math.min(Math.max(state.happiness <= 0 && state.energy <= 0 ? state.neglect + 1 : state.neglect, 0), 100),
    happiness: (!isBorn(state) || state.status === Status.SLEEPING) ? state.happiness : Math.min(Math.max(state.happiness - (probability(5) ? 1 : 0), 0), 100),
    energy: (!isBorn(state) || state.status === Status.SLEEPING) ? state.energy : Math.min(Math.max(state.energy - (probability(5) ? 1 : 0), 0), 100),
    effects: [
      ...(hasEffect(state, Effect.SICK) || probability(isBorn(state) ? 2 : 0) ? [Effect.SICK] : []),
      ...(hasEffect(state, Effect.TIRED) || probability(isBorn(state) ? 2 : 0) ? [Effect.TIRED] : []),
      ...(hasEffect(state, Effect.DIRTY) || probability(isBorn(state) ? 2 : 0) ? [Effect.DIRTY] : []),
    ],
    status: status(state)
  };
};

const initializeState = (): MakotoState => ({
  _id: uuidv4(),
  born: new Date(Date.now()),
  age: 0,
  awake: 0,
  asleep: 0,
  neglect: 0,
  happiness: 100,
  energy: 100,
  effects: [],
  status: Status.CLONE1,
}) as const;

const load = (id?: string): MakotoState => {
  if (id && localStorage.getItem(id)) {
    return JSON.parse(localStorage.getItem(id)!);
  } else if (localStorage.getItem("_")) {
    return JSON.parse(localStorage.getItem(localStorage.getItem("_")!)!);
  }
  return initializeState();
};

const save = (state: MakotoState): void => {
  localStorage.setItem("_", state._id);
  localStorage.setItem(state._id, JSON.stringify(state));
};

export type Props = {
  id: string;
};

const useMakotoState = (props?: Props) => {
  const [state, setState] = useState<MakotoState>(load(props?.id));
  const timeout = useRef<null | ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    timeout.current = setInterval(() => {
      setState(tick);
    }, TICK_INTERVAL);

    return () => {
      if (timeout.current) {
        clearInterval(timeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (state.age % SAVE_INTERVAL === 0) {
      save(state);
    }
  }, [state]);

  return {
    state,
    dispatch: (action: MakotoAction) => setState(reduce(state, action)),
    reset: () => setState({ ...initializeState(), _id: state._id })

  };
};

export default useMakotoState;