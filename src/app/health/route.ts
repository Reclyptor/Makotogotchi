// Liveness only — deliberately touches no dependency (SPEC §9): a probe that
// fails on a transient database blip turns an outage into a restart loop.
export function GET() {
  return Response.json({ status: "ok" });
}
