import Makoto from "~/components/Makoto";
import useMakotoState from "~/hooks/useMakotoState";
import type { MakotoState } from "~/types/makoto";

export default function Index() {
  const state: MakotoState = useMakotoState();

  return (
    <div className="flex items-center justify-center w-screen h-screen overflow-hidden">
      <Makoto initialState={ state } />
    </div>
  );
}
