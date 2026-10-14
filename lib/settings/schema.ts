import { z } from "zod";

/**
 * Application settings stored in the singleton `app_settings` row.
 * Shared by server and browser code (no server-only imports here).
 */

const keywordList = z.array(z.string().trim().min(1).max(40)).max(20);

export const appSettingsSchema = z.object({
  keywords: z
    .object({
      stop: keywordList.default(["STOP", "UNSUBSCRIBE"]),
      start: keywordList.default(["START", "SUBSCRIBE"]),
      human: keywordList.default(["HUMAN", "AGENT"]),
    })
    .prefault({}),
  messages: z
    .object({
      stopConfirmation: z
        .string()
        .max(1024)
        .default("You have been unsubscribed and will not receive automated replies. Send START to opt back in."),
      startConfirmation: z.string().max(1024).default("Welcome back! You will receive replies from us again."),
      handoff: z.string().max(1024).default("Thanks! A member of our team will reply to you here shortly."),
    })
    .prefault({}),
  /** Alerts forwarded to Telegram. The bot token stays in the environment (TELEGRAM_BOT_TOKEN). */
  telegram: z
    .object({
      enabled: z.boolean().default(true),
      /** Telegram chats that receive alerts: user IDs, group IDs (negative) or @channel names. */
      chatIds: z.array(z.string().regex(/^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/)).max(10).default([]),
      events: z
        .object({
          handoff: z.boolean().default(true),
          handoffMessages: z.boolean().default(true),
          leads: z.boolean().default(true),
          problems: z.boolean().default(true),
        })
        .prefault({}),
    })
    .prefault({}),
  /** E.164 digits without "+" — conversations from these numbers are marked as tests. */
  testPhoneNumbers: z.array(z.string().regex(/^\d{6,15}$/)).max(20).default([]),
  window: z
    .object({
      hours: z.number().min(1).max(24).default(24),
      /** Treat the window as closed this many minutes before it actually expires. */
      safetyMarginMinutes: z.number().int().min(0).max(120).default(10),
    })
    .prefault({}),
  rateLimits: z
    .object({
      inboundPerMinute: z.number().int().min(1).max(600).default(10),
      abuseViolationsBeforeCooldown: z.number().int().min(1).max(100).default(3),
      abuseCooldownMinutes: z.number().int().min(1).max(7 * 24 * 60).default(30),
      loginAttempts: z.number().int().min(1).max(100).default(5),
      loginWindowMinutes: z.number().int().min(1).max(1440).default(15),
      mfaAttempts: z.number().int().min(1).max(100).default(5),
      mfaWindowMinutes: z.number().int().min(1).max(1440).default(10),
      adminWritesPerMinute: z.number().int().min(1).max(1000).default(60),
      flowPublishesPerHour: z.number().int().min(1).max(500).default(20),
      flowCreatesPerHour: z.number().int().min(1).max(500).default(30),
      scheduledJobsPerExecution: z.number().int().min(1).max(200).default(25),
    })
    .prefault({}),
  usage: z
    .object({
      hardCapEnabled: z.boolean().default(false),
      /** Internal daily QStash budget used by the hard cap (≤ provider allowance). */
      qstashDailyBudget: z.number().int().min(0).default(950),
      /** Estimated Redis commands consumed per rate-limit check (sliding window ≈ 3–4). */
      redisCommandsPerCheck: z.number().min(0).max(20).default(4),
      qstashRetries: z.number().int().min(0).max(5).default(3),
    })
    .prefault({}),
  execution: z
    .object({
      /** Resume an unfinished enquiry when the customer replies within this many hours. */
      resumeWithinHours: z.number().int().min(1).max(24 * 30).default(72),
      maxStepsPerRun: z.number().int().min(10).max(500).default(100),
    })
    .prefault({}),
  retention: z
    .object({
      /** Message bodies older than this are redacted by the daily sweep (0 = keep forever). */
      messageBodyDays: z.number().int().min(0).max(3650).default(365),
      executionLogDays: z.number().int().min(0).max(3650).default(180),
      securityEventDays: z.number().int().min(0).max(3650).default(90),
    })
    .prefault({}),
  hosting: z
    .object({
      provider: z.literal("vercel").default("vercel"),
      plan: z.enum(["hobby", "pro", "enterprise"]).default("hobby"),
      environment: z.enum(["development", "production"]).default("development"),
    })
    .prefault({}),
  estimator: z
    .object({
      customersPerDay: z.number().min(0).max(100000).default(20),
      completionRate: z.number().min(0).max(1).default(0.7),
      dailyGrowthRate: z.number().min(-0.5).max(1).default(0),
      validationRetriesPerQuestion: z.number().min(0).max(10).default(0.2),
      qstashRetryRate: z.number().min(0).max(1).default(0.02),
      averageMediaSizeMb: z.number().min(0).max(100).default(2),
      newMediaAssetsPerMonth: z.number().min(0).max(1000).default(2),
      dbKbPerConversation: z.number().min(0).max(10000).default(24),
      metaCountryCode: z.string().max(4).default("IN"),
    })
    .prefault({}),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export function parseSettings(raw: unknown): AppSettings {
  const parsed = appSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : appSettingsSchema.parse({});
}

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({});
