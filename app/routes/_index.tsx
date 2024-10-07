import { useEffect, useState } from "react";
import { useEventSource } from "remix-utils/sse/react";
import Makoto, { State } from "~/components/Makoto";

export default function Index() {
  const [state, setState] = useState<State>();
  const newState = useEventSource("/sse/state");

  useEffect(() => {
    if (newState) {
      const data = JSON.parse(newState);
      const state: State = { ...data, born: new Date(data.born) };
      setState(state);
    }
  }, [newState]);

  return (
    <div className="flex items-center justify-center w-screen h-screen overflow-hidden">
      { state && <Makoto state={ state } /> }
    </div>
  );
}
