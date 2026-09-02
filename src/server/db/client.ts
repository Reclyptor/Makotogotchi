// One MongoClient per process. Next.js route handlers share module scope per
// server instance, so this is the connection pool.

import { MongoClient, type Db } from "mongodb";
import { env } from "../env";
import { once } from "../once";

// Guarded by once() rather than a null check. Two callers arriving together
// used to see `client` assigned but not yet connected, and the second was
// handed a Db from a socket that was still opening — it worked only because
// the driver buffers operations until the handshake finishes, which is a
// technicality to depend on rather than a design. The second caller now
// simply awaits the first one's connect.
const connect = once(async (): Promise<MongoClient> => {
  const client = new MongoClient(env().MONGODB_URI);
  await client.connect();
  return client;
});

export const db = async (): Promise<Db> => (await connect()).db(env().MONGODB_DB);

export const closeDb = async (): Promise<void> => {
  // Peek rather than call: a teardown that never opened a connection must not
  // open one in order to close it.
  const opened = connect.peek();
  if (!opened) return;
  connect.reset();
  // A connect that failed has nothing to close, and its rejection is the
  // caller's problem, not the teardown's.
  await opened.then((client) => client.close()).catch(() => {});
};
