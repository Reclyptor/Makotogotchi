import { CRITICAL_THRESHOLD, NEED_MAX } from "@/sim/tuning";

/** Where a need turns critical, as the whole percentage the meters and the status line both print. */
export const CRITICAL_PERCENT = (CRITICAL_THRESHOLD / NEED_MAX) * 100;
