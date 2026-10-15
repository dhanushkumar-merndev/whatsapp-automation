"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { appSettingsSchema, type AppSettings } from "@/lib/settings/schema";
import { invalidateSettingsCache, loadSettings } from "@/lib/settings/server";
import { appUrl } from "@/lib/env";
import {
  deleteTelegramWebhook,
  findTelegramChats,
  formatTelegramMessage,
  getTelegramWebhookInfo,
  sendTelegram,
  setTelegramWebhook,
  telegramConfig,
  telegramWebhookSecret,
  type TelegramChat,
} from "@/lib/notify/telegram";
import { createAdminClient } from "@/lib/supabase/admin";

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k];
    out[k] = cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/** Updates part of the application settings (validated against the full schema). */
export async function updateSettingsAction(patch: Record<string, unknown>) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const current = await loadSettings();
    const next: AppSettings = appSettingsSchema.parse(deepMerge(current, patch));
    const supabase = await createClient();
    const { error } = await supabase.from("app_settings").update({ settings: next, updated_by: session.userId, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new Error(error.message);
    invalidateSettingsCache();
    await audit(session, "settings.updated", { type: "app_settings", id: "1" }, { sections: Object.keys(patch) });
    revalidatePath("/", "layout");
  });
}

/** Sends a test alert to the given chats (or the saved ones) so the admin can confirm delivery. */
export async function sendTelegramTestAction(input: { chatIds: string[] }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "telegram_test", tokens: 10, windowSeconds: 600 } });
    const settings = appSettingsSchema.parse(deepMerge(await loadSettings(), { telegram: { chatIds: input.chatIds } }));
    const html = formatTelegramMessage(
      { kind: "test", severity: "info", title: "Star Growth Hub alerts are working", body: `Sent by ${session.fullName ?? session.loginId ?? session.email} from Settings.`, link: "/settings" },
      appUrl(),
    );
    const r = await sendTelegram(telegramConfig(settings), html);
    if (!r.ok) throw new Error(r.errors.join("; "));
    await audit(session, "telegram.test_sent", { type: "app_settings", id: "1" });
  });
}

/** Lists chats that recently messaged the bot, to pick alert recipients. */
export async function findTelegramChatsAction() {
  return runAction<TelegramChat[]>(async () => {
    await requireAdmin({ limit: { prefix: "telegram_test", tokens: 10, windowSeconds: 600 } });
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
    if ((await loadSettings()).telegram.actionButtons) {
      // With buttons on, Telegram delivers to our webhook, which remembers the chats.
      const { data } = await createAdminClient().from("telegram_chats").select("id, title, type").order("last_seen_at", { ascending: false }).limit(20);
      return (data ?? []).map((c) => ({ id: c.id as string, title: (c.title as string) ?? "Chat", type: (c.type as string) ?? "" }));
    }
    return findTelegramChats(token);
  });
}

/**
 * Turns Telegram action buttons on (registers this app as the bot's webhook) or
 * off (removes it). A bot used by another app must not be shared: only one
 * webhook can be set per bot.
 */
export async function setTelegramButtonsAction(input: { on: boolean }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "telegram_test", tokens: 10, windowSeconds: 600 } });
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");
    const on = z.boolean().parse(input.on);
    if (on) {
      const url = `${appUrl()}/api/webhooks/telegram`;
      if (!url.startsWith("https://")) throw new Error("Telegram needs an https address. Turn buttons on from the deployed site.");
      await setTelegramWebhook(token, url, telegramWebhookSecret());
    } else {
      await deleteTelegramWebhook(token);
    }
    const supabase = await createClient();
    const next = appSettingsSchema.parse(deepMerge(await loadSettings(), { telegram: { actionButtons: on } }));
    const { error } = await supabase.from("app_settings").update({ settings: next, updated_by: session.userId, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new Error(error.message);
    invalidateSettingsCache();
    await audit(session, on ? "telegram.buttons_on" : "telegram.buttons_off", { type: "app_settings", id: "1" });
    revalidatePath("/settings");
  });
}

/** Whether the bot's webhook points at this app (for the Settings status line). */
export async function telegramButtonsStatusAction() {
  return runAction(async () => {
    await requireAdmin();
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return { connected: false, detail: "TELEGRAM_BOT_TOKEN is not set." };
    const info = await getTelegramWebhookInfo(token);
    const expected = `${appUrl()}/api/webhooks/telegram`;
    return {
      connected: info.url === expected,
      detail: info.url
        ? info.url === expected
          ? info.last_error_message
            ? `Connected, last error: ${info.last_error_message}`
            : "Connected"
          : `The bot sends updates to another address (${info.url}).`
        : "Not connected.",
    };
  });
}
