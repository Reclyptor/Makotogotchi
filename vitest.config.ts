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
    // Phase 0 scaffold only — remove the moment Phase 1 lands its first test,
    // so an include-glob mistake can never silently green-light CI.
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/sim/**", "src/server/**", "src/game/**"],
    },
  },
});
