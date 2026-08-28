// Ephemeral real infrastructure for the integration tests (SPEC §16.4):
// dockerized Mongo and Redis on random host ports, started once per test
// file and torn down after. Real stores, no mocks — the tests exercise the
// same drivers, the same index behavior, and the same locking semantics as
// production. (mongodb-memory-server is not used: its downloaded binaries
// cannot run on NixOS, and docker is available both locally and in CI.)

import { execFileSync } from "node:child_process";
import { resetEnvCache } from "./env";
import { resetIndexCache } from "./db/collections";

export type TestInfra = {
  mongoUri: string;
  redisUrl: string;
  stop: () => void;
};

const startContainer = (image: string, containerPort: number, args: string[] = []): { id: string; port: string } => {
  const id = execFileSync("docker", ["run", "-d", "--rm", "-p", `127.0.0.1:0:${containerPort}`, image, ...args])
    .toString()
    .trim();
  const mapping = execFileSync("docker", ["port", id, String(containerPort)]).toString().trim();
  const port = mapping.split("\n")[0]!.split(":").pop()!;
  return { id, port };
};

const waitForMongo = (containerId: string): void => {
  // Ping mongod until it answers rather than sleeping a guessed duration.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      execFileSync("docker", ["exec", containerId, "mongosh", "--quiet", "--eval", "db.runCommand({ ping: 1 })"], {
        stdio: "ignore",
      });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error("mongo container did not become ready");
      execFileSync("sleep", ["0.25"]);
    }
  }
};

export type TestInfraOptions = {
  /**
   * Start Mongo alongside Redis. Default true, which is what almost every
   * suite wants. A Redis-only suite passes false: the pair costs a container
   * and a readiness poll per test *file*, and the files run in parallel, so
   * booting a database nobody queries is load the docker daemon does not need
   * — enough of it and a suite starts losing its `beforeAll` to the timeout.
   * `MONGODB_URI` is still set, to an address nothing listens on, so `env()`
   * validates and an accidental query fails loudly instead of silently
   * reaching some other suite's database.
   */
  mongo?: boolean;
};

export const startTestInfra = ({ mongo: withMongo = true }: TestInfraOptions = {}): TestInfra => {
  const mongo = withMongo ? startContainer("mongo:8", 27017) : null;
  const redis = startContainer("redis:8-alpine", 6379);
  if (mongo) waitForMongo(mongo.id);

  const infra: TestInfra = {
    mongoUri: mongo ? `mongodb://127.0.0.1:${mongo.port}` : "mongodb://127.0.0.1:1",
    redisUrl: `redis://127.0.0.1:${redis.port}`,
    stop: () => {
      for (const id of [mongo?.id, redis.id]) {
        if (!id) continue;
        try {
          execFileSync("docker", ["stop", id]);
        } catch {
          // Already gone — teardown is best-effort by design.
        }
      }
    },
  };

  process.env.MONGODB_URI = infra.mongoUri;
  process.env.MONGODB_DB = "makotogotchi-test";
  process.env.REDIS_URL = infra.redisUrl;
  process.env.CARETAKER_SECRET = "test-secret-test-secret-test-secret!";
  resetEnvCache();
  resetIndexCache();
  return infra;
};
