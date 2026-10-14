import { z } from "zod";

/**
 * Environment validation. Values are parsed lazily (on first use) so that
 * `next build` does not require secrets, while every runtime path that needs
 * a secret fails fast with a message naming the missing variable.
 */

const nonEmpty = z.string().trim().min(1);

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty,
});

const serverSchema = publicSchema.extend({
  APP_ENV: z.enum(["development", "production"]).default("development"),
  APP_ENCRYPTION_KEY: nonEmpty.refine(
    (v) => Buffer.from(v, "base64").length === 32,
    "must be 32 random bytes encoded as base64 (openssl rand -base64 32)",
  ),
  CRON_SECRET: nonEmpty.min(16, "must be at least 16 characters"),
  SUPABASE_SECRET_KEY: nonEmpty,
  META_APP_SECRET: nonEmpty,
  META_WEBHOOK_VERIFY_TOKEN: nonEmpty,
  // Optional at boot so inbound webhooks are still recorded; sending fails with a clear error without it.
  META_ACCESS_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  META_WABA_ID: nonEmpty,
  META_PHONE_NUMBER_ID: nonEmpty,
  QSTASH_URL: z.url().default("https://qstash.upstash.io"),
  QSTASH_TOKEN: nonEmpty,
  QSTASH_CURRENT_SIGNING_KEY: nonEmpty,
  QSTASH_NEXT_SIGNING_KEY: nonEmpty,
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: nonEmpty,
  UPSTASH_MANAGEMENT_EMAIL: z.string().optional(),
  UPSTASH_MANAGEMENT_API_KEY: z.string().optional(),
  UPSTASH_REDIS_DATABASE_ID: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

function emptyToUndefined(source: Record<string, string | undefined>) {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) out[k] = v === "" ? undefined : v;
  return out;
}

function format(error: z.ZodError) {
  return error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

let cachedServer: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cachedServer) return cachedServer;
  const parsed = serverSchema.safeParse(emptyToUndefined(process.env));
  if (!parsed.success) {
    throw new Error(
      `Invalid or missing environment variables (see .env.example):\n${format(parsed.error)}`,
    );
  }
  cachedServer = parsed.data;
  return cachedServer;
}

/** Public values are inlined by Next.js at build time, so read them explicitly. */
export function publicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse(
    emptyToUndefined({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    }),
  );
  if (!parsed.success) {
    throw new Error(
      `Invalid or missing public environment variables (see .env.example):\n${format(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function isProduction() {
  return (process.env.APP_ENV ?? "development") === "production";
}

/** Base URL without trailing slash, used for QStash callbacks and auth redirects. */
export function appUrl() {
  return publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

/** For tests only. */
export function __resetEnvCache() {
  cachedServer = null;
}
