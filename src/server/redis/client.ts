// Redis connections and the key namespace. Every key and channel goes
// through key() — the mgc: prefix is what isolates this app on the shared
// cluster instance, and pub/sub channels are global to the instance no
// matter which logical DB is selected (SPEC §6.2).

import Redis from "ioredis";
import { env } from "../env";

let client: Redis | null = null;
let subscriber: Redis | null = null;

/**
 * Open a connection that survives losing Redis.
 *
 * ioredis reconnects on its own, and every caller here is already written to
 * tolerate a failed round trip — the tick loop retries next interval, the
 * write lock throws and the request 500s, the hub falls back to the room
 * cache's TTL. What none of that survives is the `error` event itself:
 * EventEmitter rethrows an unhandled `error` as an uncaught exception, so a
 * blip the client was about to recover from instead takes the pod down.
 * Listening is the whole fix — the recovery already exists.
 */
const connect = (role: string): Redis => {
  const connection = new Redis(env().REDIS_URL);
  connection.on("error", (error: unknown) => {
    console.error(`redis ${role} connection error`, error);
  });
  return connection;
};

export const redis = (): Redis => {
  client ??= connect("command");
  return client;
};

/** A subscribed connection cannot issue commands; pub/sub gets its own. */
export const redisSubscriber = (): Redis => {
  subscriber ??= connect("subscriber");
  return subscriber;
};

export const key = (name: string): string => `${env().REDIS_PREFIX}${name}`;

export const closeRedis = async (): Promise<void> => {
  await Promise.all([client?.quit(), subscriber?.quit()]);
  client = null;
  subscriber = null;
};
