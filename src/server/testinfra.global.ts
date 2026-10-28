// One Mongo and one Redis for the whole test run (SPEC §16.4).
//
// Every integration file used to boot its own pair. Twenty files running in
// parallel meant forty `docker run`s racing the daemon, and the ones that lost
// failed their `beforeAll` — a different file each run, always with
// `Command failed: docker run`, never with an assertion. Worse, a file whose
// setup threw never reached its teardown, so it leaked the container it *had*
// started, which made the next run likelier to lose the same race.
//
// The containers start once here and are torn down once. Isolation moves to
// where it is cheap: each file gets its own Mongo database and its own Redis
// key prefix, both of which the app already reads from the environment.

import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

const started: string[] = [];

const startContainer = (image: string, containerPort: number): string => {
  // No --rm: a container that dies on boot must outlive its exit, or its logs
  // go with it and the only clue left is "did not become ready". It is named
  // and tracked before it runs, so teardown also removes one whose `docker
  // run` failed after creating it (a port that lost a bind race, say).
  const id = `makotogotchi-test-${process.pid}-${containerPort}`;
  started.push(id);
  execFileSync("docker", ["run", "-d", "--name", id, "-p", `127.0.0.1:0:${containerPort}`, image]);
  const mapping = execFileSync("docker", ["port", id, String(containerPort)]).toString().trim();
  return mapping.split("\n")[0]!.split(":").pop()!;
};

const waitForMongo = (): void => {
  // Ping mongod until it answers rather than sleeping a guessed duration.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      execFileSync("docker", ["exec", started[0]!, "mongosh", "--quiet", "--eval", "db.runCommand({ ping: 1 })"], {
        stdio: "ignore",
      });
      return;
    } catch {
      if (Date.now() > deadline) {
        const logs = execFileSync("docker", ["logs", "--tail", "50", started[0]!], { stdio: "pipe" }).toString();
        const state = execFileSync("docker", ["inspect", "--format", "{{json .State}}", started[0]!]).toString();
        throw new Error(`mongo container did not become ready\nstate: ${state}\n${logs}`);
      }
      execFileSync("sleep", ["0.25"]);
    }
  }
};

export const setup = (project: TestProject): void => {
  // A setup that throws is never torn down, so it cleans up after itself.
  try {
    const mongoPort = startContainer("mongo:8", 27017);
    const redisPort = startContainer("redis:8-alpine", 6379);
    waitForMongo();
    project.provide("mongoUri", `mongodb://127.0.0.1:${mongoPort}`);
    project.provide("redisUrl", `redis://127.0.0.1:${redisPort}`);
  } catch (error) {
    teardown();
    throw error;
  }
};

export const teardown = (): void => {
  for (const id of started.splice(0)) {
    try {
      execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
    } catch {
      // Already gone — teardown is best-effort by design.
    }
  }
};

declare module "vitest" {
  interface ProvidedContext {
    mongoUri: string;
    redisUrl: string;
  }
}
