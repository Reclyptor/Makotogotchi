// E2E web-server entry: Playwright launches the webServer BEFORE
// globalSetup runs, so the ephemeral stores must come up here, ahead of the
// app process. Plain JS on purpose — this file runs directly under node.

import { execFileSync, spawn } from "node:child_process";

const run = (args, options = {}) => execFileSync("docker", args, options).toString().trim();

for (const name of ["mgc-e2e-mongo", "mgc-e2e-redis"]) {
  try {
    execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  } catch {
    // No stale container — fine.
  }
}

const mongoId = run(["run", "-d", "--rm", "--name", "mgc-e2e-mongo", "-p", "127.0.0.1:27227:27017", "mongo:8"]);
run(["run", "-d", "--rm", "--name", "mgc-e2e-redis", "-p", "127.0.0.1:6579:6379", "redis:8-alpine"]);

const deadline = Date.now() + 30_000;
for (;;) {
  try {
    execFileSync("docker", ["exec", mongoId, "mongosh", "--quiet", "--eval", "db.runCommand({ ping: 1 })"], {
      stdio: "ignore",
    });
    break;
  } catch {
    if (Date.now() > deadline) throw new Error("mongo container did not become ready");
    execFileSync("sleep", ["0.25"]);
  }
}

// Pin the pet's timezone so "now" is always midday LOCAL time: the sim
// sleeps 22:00–07:00 in its zone, and a CI run during that window would
// find the pet asleep and fail every care test. Etc/GMT zone signs are
// POSIX-inverted (Etc/GMT-5 means UTC+5).
const utcHour = new Date().getUTCHours();
let shift = 12 - utcHour;
if (shift > 14) shift -= 24;
if (shift < -12) shift += 24;
const petTimezone = shift >= 0 ? `Etc/GMT-${shift}` : `Etc/GMT+${-shift}`;
console.log(`e2e pet timezone: ${petTimezone} (local hour ≈ ${(utcHour + shift + 24) % 24})`);

const port = process.argv[2] ?? "13100";
const server = spawn("npx", ["next", "start", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, PET_TIMEZONE: petTimezone },
});
server.on("exit", (code) => process.exit(code ?? 1));
