// Every configuration value is read exactly once, validated, and frozen. A
// missing or malformed variable crashes the process at first use rather than
// producing an undefined at 3am (SPEC §15). No other module touches
// process.env.

import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("makotogotchi"),
  REDIS_URL: z.string().min(1),
  REDIS_PREFIX: z.string().min(1).default("mgc:"),
  CARETAKER_SECRET: z.string().min(32),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  PET_TIMEZONE: z.string().min(1).default("America/Chicago"),
  /** SSE connections allowed per client IP (SPEC §8.3). The e2e harness
   *  raises it — every Playwright worker shares 127.0.0.1. */
  MAX_STREAMS_PER_IP: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export const env = (): Env => {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`invalid environment: ${missing}`);
  }
  cached = parsed.data;
  return cached;
};

/** Test seam: lets integration tests point at ephemeral stores. */
export const resetEnvCache = (): void => {
  cached = null;
};
