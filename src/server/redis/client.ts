// Redis connections and the key namespace. Every key and channel goes
// through key() — the mgc: prefix is what isolates this app on the shared
// cluster instance, and pub/sub channels are global to the instance no
// matter which logical DB is selected (SPEC §6.2).

import Redis from "ioredis";
import { env } from "../env";

let client: Redis | null = null;
let subscriber: Redis | null = null;

export const redis = (): Redis => {
  client ??= new Redis(env().REDIS_URL);
  return client;
};

/** A subscribed connection cannot issue commands; pub/sub gets its own. */
export const redisSubscriber = (): Redis => {
  subscriber ??= new Redis(env().REDIS_URL);
  return subscriber;
};

export const key = (name: string): string => `${env().REDIS_PREFIX}${name}`;

export const closeRedis = async (): Promise<void> => {
  await Promise.all([client?.quit(), subscriber?.quit()]);
  client = null;
  subscriber = null;
};
