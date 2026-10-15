"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { appSettingsSchema, type AppSettings } from "@/lib/settings/schema";
import { invalidateSettingsCache, loadSettings } from "@/lib/settings/server";
import { appUrl } from "@/lib/env";
import { findTelegramChats, formatTelegramMessage, sendTelegram, telegramConfig, type TelegramChat } from "@/lib/notify/telegram";

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
    return findTelegramChats(token);
  });
}
