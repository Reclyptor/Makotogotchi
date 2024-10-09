import { MakotoState } from "~/types/makoto";
import { v4 as uuidv4 } from "uuid";

const initializeState = (): MakotoState => ({
  _id: uuidv4(),
  born: new Date(Date.now()),
  hunger: 0,
  happiness: 100,
  sick: false,
  sleeping: false
}) as const;

export type Props = {
  id: string;
};

const useMakotoState = (props?: Props) => {
  if (props?.id) {
    // TODO: Fetch state by ID from browser storage
    return initializeState();
  }
  return initializeState();
};

export default useMakotoState;