// Readiness: verifies the dependencies /health deliberately ignores
// (SPEC §9). Kubernetes stops routing traffic while a store is unreachable
// instead of restart-looping the pod.

import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { redis } from "@/server/redis/client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await Promise.all([(await db()).command({ ping: 1 }), redis().ping()]);
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
