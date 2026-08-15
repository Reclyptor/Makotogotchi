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

export const startTestInfra = (): TestInfra => {
  const mongo = startContainer("mongo:8", 27017);
  const redis = startContainer("redis:8-alpine", 6379);
  waitForMongo(mongo.id);

  const infra: TestInfra = {
    mongoUri: `mongodb://127.0.0.1:${mongo.port}`,
    redisUrl: `redis://127.0.0.1:${redis.port}`,
    stop: () => {
      for (const id of [mongo.id, redis.id]) {
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
