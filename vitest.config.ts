import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The suite is CPU-bound pixel work and property runs beside real Mongo, and
    // it runs on a machine shared with other sessions' builds. A test that takes
    // a second alone has taken more than the default five on a loaded box, and
    // which one it is changes from run to run: it is the load, not a test.
    testTimeout: 20_000,
    // One Mongo and one Redis for the whole run, rather than a pair per file
    // racing the docker daemon (SPEC §16.4).
    globalSetup: ["./src/server/testinfra.global.ts"],
    coverage: {
      provider: "v8",
      include: ["src/sim/**", "src/server/**", "src/game/**"],
    },
  },
});
