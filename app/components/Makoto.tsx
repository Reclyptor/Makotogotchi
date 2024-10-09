import React from "react";
import { MakotoState } from "~/hooks/useMakotoState";
import Sprite from "~/components/Sprite";
import configuration from "~/resources/configuration";

export const sequenceOf = (state: MakotoState): keyof typeof configuration.sequences => {
  if (state.age < 60) return "clonePhase1";
  if (state.age < 120) return "clonePhase2";
  if (state.age < 180) return "clonePhase3";
  if (state.age < 240) return "clonePhase4";
  return "idle";
};

export type MakotoProps = {
  state: MakotoState;
};

const Makoto = (props: MakotoProps) => {
  return (
    <Sprite { ...configuration } sequence={ sequenceOf(props.state) } />
  );
};

export default Makoto;