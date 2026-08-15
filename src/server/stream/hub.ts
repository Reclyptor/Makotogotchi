// SSE fanout hub: ONE Redis subscription per process, broadcast to every
// connected local client. A thousand open streams cost one Redis connection,
// not a thousand (SPEC §7).

import { redisSubscriber } from "../redis/client";
import { key } from "../redis/client";

type Listener = (payload: string) => void;

const GLOBAL_KEY = Symbol.for("makotogotchi.streamhub");

type Hub = {
  listeners: Set<Listener>;
  subscribed: boolean;
};

type GlobalWithHub = typeof globalThis & { [GLOBAL_KEY]?: Hub };

const hub = (): Hub => {
  const holder = globalThis as GlobalWithHub;
  holder[GLOBAL_KEY] ??= { listeners: new Set(), subscribed: false };
  return holder[GLOBAL_KEY];
};

export const subscribeToEvents = async (listener: Listener): Promise<() => void> => {
  const state = hub();
  if (!state.subscribed) {
    state.subscribed = true;
    const subscriber = redisSubscriber();
    await subscriber.subscribe(key("events"));
    subscriber.on("message", (channel, payload) => {
      if (channel !== key("events")) return;
      for (const registered of state.listeners) registered(payload);
    });
  }
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
};
