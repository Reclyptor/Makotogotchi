import { v4 as uuidv4 } from "uuid";
import { useEffect, useRef, useState } from "react";
import { probability } from "~/util/probability";

const TICK_INTERVAL = 1000 as const;
const SAVE_INTERVAL = 60 as const;

export enum Status {
  DEAD = "DEAD",
  CLONE1 = "CLONE1",
  CLONE2 = "CLONE2",
  CLONE3 = "CLONE3",
  CLONE4 = "CLONE4",
  IDLE = "IDLE",
  ANGRY = "ANGRY",
  BORED = "BORED",
  TIRED = "TIRED",
  EATING = "EATING",
  GAMING = "GAMING",
  JOGGING = "JOGGING",
  WALKING = "WALKING",
  MEALTIME = "MEALTIME",
  SLEEPING = "SLEEPING",
  STANDING = "STANDING",
  ANGRY_DIRTY = "ANGRY_DIRTY",
  SLEEPING_SICK = "SLEEPING_SICK",
}

export type MakotoState = {
  _id: string;
  born: Date;
  age: number;
  neglect: number;
  happiness: number;
  energy: number;
  sick: boolean;
  tired: boolean;
  dirty: boolean;
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
  switch (action) {
    case MakotoAction.FEED:
      return {
        ...state,
        neglect: 0,
        energy: Math.min(Math.max(state.energy + 10, 0), 100)
      };
    case MakotoAction.SLEEP:
      return {
        ...state,
        neglect: 0,
        status: Status.SLEEPING
      };
    case MakotoAction.PLAY:
      return {
        ...state,
        neglect: 0,
        happiness: Math.min(Math.max(state.happiness + 10, 0), 100)
      };
    case MakotoAction.MEDICATE:
      return {
        ...state,
        neglect: 0,
        sick: false
      };
    case MakotoAction.BATHE:
      return {
        ...state,
        neglect: 0,
        dirty: false
      };
    case MakotoAction.PET:
      return {
        ...state,
        neglect: 0,
        happiness: Math.min(Math.max(state.happiness + 10, 0), 100)
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
  return Status.IDLE;
};

const tick = (state: MakotoState): MakotoState => {
  return {
    _id: state._id,
    born: state.born,
    age: state.status === Status.DEAD ? state.age : state.age + 1,
    neglect: Math.min(Math.max(state.happiness <= 0 && state.energy <= 0 ? state.neglect + 1 : state.neglect, 0), 100),
    happiness: Math.min(Math.max(state.age >= 240 ? state.happiness - (probability(5) ? 1 : 0) : state.happiness, 0), 100),
    energy: Math.min(Math.max(state.age >= 240 ? state.energy - (probability(5) ? 1 : 0) : state.energy, 0), 100),
    sick: state.sick || probability(2),
    tired: state.tired || (probability(5) && state.energy < 50),
    dirty: state.dirty || probability(2),
    status: status(state)
  };
};

const initializeState = (): MakotoState => ({
  _id: uuidv4(),
  born: new Date(Date.now()),
  age: 0,
  neglect: 0,
  happiness: 100,
  energy: 100,
  sick: false,
  tired: false,
  dirty: false,
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

  return { state, dispatch: (action: MakotoAction) => setState(reduce(state, action)), reset: () => setState({ ...initializeState(), _id: state._id }) };
};

export default useMakotoState;