import type { LoaderFunction } from "@remix-run/node";
import { eventStream } from "remix-utils/sse/server";
import * as makotoService from "~/.server/db/service/makoto";
import type { Makoto as State } from "~/.server/db/models/makoto";

let state: State | null = null;

export const loader: LoaderFunction = async ({ request }) => {
  if (!state) {
    state = await makotoService.getMakoto();
  }

  const advanceState = (_state: State) => {
    return {
      ..._state,
      happiness: Math.max(0, Math.min(100, _state.happiness + Math.round(Math.random() * 20 - 10))),
      hunger: Math.max(0, Math.min(100, _state.hunger + Math.round(Math.random() * 20 - 10))),
      sick: Math.random() < 0.01,
      sleeping: Math.random() < 0.01
    };
  };

  return eventStream(request.signal, (send) => {
    const loop = () => {
      send({ data: JSON.stringify(state) });
      state = advanceState(state!);
    };

    loop(); // Send initial state immediately and advance it to the next state

    const timeout = setInterval(loop, 1000); // Repeat every second

    request.signal.addEventListener("abort", () => {
      clearInterval(timeout);
    });

    return () => {
      clearInterval(timeout);
    };
  });
};