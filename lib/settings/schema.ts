import { z } from "zod";

/**
 * Application settings stored in the singleton `app_settings` row.
 * Shared by server and browser code (no server-only imports here).
 */

const keywordList = z.array(z.string().trim().min(1).max(40)).max(20);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM");
const dayHours = (open: boolean) =>
  z.object({ open: z.boolean().default(open), from: clock.default("10:00"), to: clock.default("19:00") }).prefault({});

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
          bookings: z.boolean().default(true),
          flowAlerts: z.boolean().default(true),
          problems: z.boolean().default(true),
        })
        .prefault({}),
    })
    .prefault({}),
  business: z
    .object({
      /** Used for dates in answers, bookings and business hours. */
      timezone: z.string().max(60).default("Asia/Kolkata"),
      /** Opening hours per weekday, for the "within business hours" condition. */
      hours: z
        .object({
          sun: dayHours(false),
          mon: dayHours(true),
          tue: dayHours(true),
          wed: dayHours(true),
          thu: dayHours(true),
          fri: dayHours(true),
          sat: dayHours(true),
        })
        .prefault({}),
    })
    .prefault({}),
  /** Same number in the WhatsApp Business app and the API. */
  coexistence: z
    .object({
      /** "pause": replying from the phone app hands that chat to a person until you hand it back. */
      onAppReply: z.enum(["pause", "ignore"]).default("pause"),
      /** Hand chats back to the bot after this many hours without a human reply (0 = never). */
      autoResumeHours: z.number().int().min(0).max(24 * 14).default(0),
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
  execution: z
    .object({
      /** Resume an unfinished enquiry when the customer replies within this many hours. */
      resumeWithinHours: z.number().int().min(1).max(24 * 30).default(72),
      maxStepsPerRun: z.number().int().min(10).max(500).default(100),
      /** Waits up to this long run inside the reply itself (no QStash hop); longer waits are scheduled. */
      inlineWaitMaxSeconds: z.number().int().min(0).max(25).default(20),
      /** QStash retries for scheduled steps and CRM retries. */
      qstashRetries: z.number().int().min(0).max(5).default(3),
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
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export function parseSettings(raw: unknown): AppSettings {
  const parsed = appSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : appSettingsSchema.parse({});
}

export const DEFAULT_SETTINGS: AppSettings = appSettingsSchema.parse({});
