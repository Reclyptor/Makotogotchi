import { defineConfig } from "@playwright/test";

// E2E infrastructure (SPEC §16.5): globalSetup boots dockerized Mongo/Redis
// and hatches a pet; webServer runs the production build against them.
//
// PLAYWRIGHT_CHROME: NixOS cannot execute Playwright's downloaded chromium
// (dynamic linking), so local runs point at the system Chrome via
// `npm run test:e2e`. CI uses the default download.

export const E2E = {
  appPort: 13100,
  mongoUri: "mongodb://127.0.0.1:27227",
  redisUrl: "redis://127.0.0.1:6579",
  caretakerSecret: "e2e-secret-e2e-secret-e2e-secret-e2e!",
} as const;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${E2E.appPort}`,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROME ? { executablePath: process.env.PLAYWRIGHT_CHROME } : {}),
    },
  },
  webServer: {
    command: `node e2e/start-stack.mjs ${E2E.appPort}`,
    url: `http://localhost:${E2E.appPort}/ready`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      MONGODB_URI: E2E.mongoUri,
      MONGODB_DB: "makotogotchi-e2e",
      REDIS_URL: E2E.redisUrl,
      CARETAKER_SECRET: E2E.caretakerSecret,
      // Every Playwright worker connects from 127.0.0.1; the production
      // per-IP stream cap would reject parallel specs' EventSources.
      MAX_STREAMS_PER_IP: "40",
      // Same address, same reason (SPEC §8.2). The whole suite's traffic —
      // every page load, poll, care action and minigame heartbeat in every
      // spec — arrives on one IP, where production would see a crowd. The
      // per-caretaker budget is raised alongside it: a spec drives a single
      // cookie far harder than a person ever plays.
      RATE_LIMIT_PER_IP: "6000",
      RATE_LIMIT_PER_CARETAKER: "3000",
    },
  },
});
