import { v4 as uuidv4 } from "uuid";
import { useEffect, useRef, useState } from "react";

const TICK_INTERVAL = 1000 as const;
const SAVE_INTERVAL = 60 as const;

export type MakotoState = {
  _id: string;
  born: Date;
  age: number;
  hunger: number;
  happiness: number;
  sick: boolean;
  dirty: boolean;
  sleeping: boolean;
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
  switch (action) {
    case MakotoAction.FEED:
      return {
        ...state,
        hunger: Math.max(state.hunger - 10, 0)
      };
    case MakotoAction.SLEEP:
      return {
        ...state,
        sleeping: true
      };
    case MakotoAction.PLAY:
      return {
        ...state,
        happiness: Math.min(state.happiness + 20, 100)
      };
    case MakotoAction.MEDICATE:
      return {
        ...state,
        sick: false
      };
    case MakotoAction.BATHE:
      return {
        ...state,
        happiness: Math.min(state.happiness + 10, 100)
      };
    case MakotoAction.PET:
      return {
        ...state,
        happiness: Math.min(state.happiness + 10, 100)
      };
    default:
      return state;
  }
};

const tick = (state: MakotoState): MakotoState => {
  return {
    _id: state._id,
    born: state.born,
    age: state.age + 1,
    hunger: 0,
    happiness: 100,
    sick: false,
    dirty: false,
    sleeping: false
  };
};

const initializeState = (): MakotoState => ({
  _id: uuidv4(),
  born: new Date(Date.now()),
  age: 0,
  hunger: 0,
  happiness: 100,
  sick: false,
  dirty: false,
  sleeping: false
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

  return { state, dispatch: (action: MakotoAction) => setState(reduce(state, action)) };
};

export default useMakotoState;