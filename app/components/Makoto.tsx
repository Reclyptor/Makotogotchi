import React from "react";
import { MakotoState, Status } from "~/hooks/useMakotoState";
import Sprite, { Sequence } from "~/components/Sprite";
import configuration, { SEQUENCES } from "~/resources/configuration";

export const mapStateToSequence = (state: MakotoState): Sequence => {
  switch (state.status) {
    case Status.CLONE1: return SEQUENCES.clonePhase1;
    case Status.CLONE2: return SEQUENCES.clonePhase2;
    case Status.CLONE3: return SEQUENCES.clonePhase3;
    case Status.CLONE4: return SEQUENCES.clonePhase4;
    case Status.DEAD: return SEQUENCES.dead;
    case Status.SLEEPING: {
      if (state.sick) return SEQUENCES.sick;
      else return SEQUENCES.sleeping;
    }
    case Status.PLAYING: return SEQUENCES.gaming;
    case Status.IDLE: {
      if (state.sick) return SEQUENCES.sick;
      if (state.tired) return SEQUENCES.tired;
      if (state.dirty) return SEQUENCES.dirty;
      return SEQUENCES.idle;
    }
    default: return SEQUENCES.idle;
  }
};

export type MakotoProps = {
  state: MakotoState;
};

const Makoto = (props: MakotoProps) => {
  return (
    <Sprite { ...configuration } sequence={ mapStateToSequence(props.state) } />
  );
};

export default Makoto;