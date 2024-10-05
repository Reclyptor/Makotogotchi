import React, { useState } from "react";
import Sprite from "~/components/Sprite";
import configuration from "~/resources/configuration";

const [INITIAL_STATE]: [State] = [{
  hunger: 0,
  happiness: 100,
  age: 0,
  sick: false,
  sleep: false,
}];

export type State = {
  hunger: number;
  happiness: number;
  age: number;
  sick: boolean;
  sleep: boolean;
};

export type MakotoProps = {
  state?: State;
};

const Makoto = (props: MakotoProps) => {
  const [state, setState] = useState<State>(props.state || INITIAL_STATE);
  const [sequence, setSequence] = useState<keyof typeof configuration.sequences>(configuration.sequence);

  return (
    <Sprite { ...configuration } sequence={ configuration.sequence } />
  );
};

export default Makoto;