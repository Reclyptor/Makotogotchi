import { execFileSync } from "node:child_process";

export default function globalTeardown(): void {
  for (const name of ["mgc-e2e-mongo", "mgc-e2e-redis"]) {
    try {
      execFileSync("docker", ["stop", name], { stdio: "ignore" });
    } catch {
      // Already gone — teardown is best-effort by design.
    }
  }
}
