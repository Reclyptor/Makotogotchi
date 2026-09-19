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
    // One Mongo and one Redis for the whole run, rather than a pair per file
    // racing the docker daemon (SPEC §16.4).
    globalSetup: ["./src/server/testinfra.global.ts"],
    coverage: {
      provider: "v8",
      include: ["src/sim/**", "src/server/**", "src/game/**"],
    },
  },
});
