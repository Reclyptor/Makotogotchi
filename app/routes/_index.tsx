import Makoto from "~/components/Makoto";
import useMakotoState from "~/hooks/useMakotoState";

export default function Index() {
  const { state, dispatch } = useMakotoState();

  return (
    <div className="flex items-center justify-center w-screen h-screen overflow-hidden">
      <Makoto state={ state } />
    </div>
  );
}
