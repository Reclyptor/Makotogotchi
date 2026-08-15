// Next.js server-start hook: boot the engine and the leader-gated tick loop
// as soon as the process is up, not on first traffic. The pet simulates
// whether or not anyone is watching (SPEC §1.1).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runtime } = await import("@/server/runtime");
    await runtime();
  }
}
