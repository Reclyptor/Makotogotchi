// One MongoClient per process. Next.js route handlers share module scope per
// server instance, so this is the connection pool.

import { MongoClient, type Db } from "mongodb";
import { env } from "../env";

let client: MongoClient | null = null;

export const db = async (): Promise<Db> => {
  if (!client) {
    client = new MongoClient(env().MONGODB_URI);
    await client.connect();
  }
  return client.db(env().MONGODB_DB);
};

export const closeDb = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
  }
};
