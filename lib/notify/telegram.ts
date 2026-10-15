import { createHmac } from "node:crypto";
import type { NotificationInput } from "@/lib/engine/types";
import type { AppSettings } from "@/lib/settings/schema";

/**
 * Forwards selected dashboard notifications to Telegram so the team hears about
 * handoffs and new leads without watching the dashboard. With action buttons on
 * (Settings), chat alerts carry buttons — Bot on, Restart flow, Close, Take
 * over — handled by /api/webhooks/telegram.
 */

export type TelegramEvent = keyof AppSettings["telegram"]["events"];

const EVENT_BY_KIND: Record<string, TelegramEvent> = {
  handoff: "handoff",
  handoff_app: "handoff",
  handoff_message: "handoffMessages",
  lead_submitted: "leads",
  booking_created: "bookings",
  team_alert: "flowAlerts",
  crm_failed: "problems",
  window_expired: "problems",
  automation_error: "problems",
  media_missing: "problems",
};

const ICON: Record<NotificationInput["severity"], string> = { info: "🔔", warning: "⚠️", critical: "🚨" };
const ICON_BY_KIND: Record<string, string> = { handoff: "🙋", handoff_app: "📱", handoff_message: "💬", lead_submitted: "✅", booking_created: "📅", team_alert: "📣" };

export function telegramEventFor(kind: string): TelegramEvent | null {
  return EVENT_BY_KIND[kind] ?? null;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

/** Telegram button data: "<action letter>:<conversation id>" (≤ 64 bytes). */
export const BUTTON_ACTIONS = { r: "bot_on", s: "restart", h: "human", c: "close" } as const;
export type ButtonCode = keyof typeof BUTTON_ACTIONS;

/** Buttons for a chat that is with a person (bot paused) or with the bot. */
export function chatKeyboard(conversationId: string, withPerson: boolean): InlineKeyboard {
  return withPerson
    ? {
        inline_keyboard: [
          [
            { text: "🤖 Bot on", callback_data: `r:${conversationId}` },
            { text: "🔁 Restart flow", callback_data: `s:${conversationId}` },
          ],
          [{ text: "✖️ Close chat", callback_data: `c:${conversationId}` }],
        ],
      }
    : { inline_keyboard: [[{ text: "🙋 Take over", callback_data: `h:${conversationId}` }]] };
}

/** Alerts about a chat with a person get "Bot on / Restart / Close"; leads, bookings and workflow alerts get "Take over". */
export function alertKeyboard(input: NotificationInput): InlineKeyboard | undefined {
  if (!input.conversationId) return undefined;
  if (input.kind === "handoff" || input.kind === "handoff_app" || input.kind === "handoff_message") return chatKeyboard(input.conversationId, true);
  if (input.kind === "lead_submitted" || input.kind === "booking_created" || input.kind === "team_alert") return chatKeyboard(input.conversationId, false);
  return undefined;
}

/** Telegram HTML message: icon + bold title, body, and a link back to the dashboard. */
export function formatTelegramMessage(input: NotificationInput, baseUrl: string): string {
  const icon = ICON_BY_KIND[input.kind] ?? ICON[input.severity];
  const lines = [`${icon} <b>${escapeHtml(input.title)}</b>`];
  if (input.body?.trim()) lines.push("", escapeHtml(input.body.trim().slice(0, 3000)));
  if (input.link) {
    const href = input.link.startsWith("http") ? input.link : `${baseUrl.replace(/\/+$/, "")}${input.link}`;
    lines.push("", `<a href="${escapeHtml(href)}">Open in dashboard</a>`);
  }
  return lines.join("\n");
}

export function parseChatIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/.test(s));
}

export interface TelegramConfig {
  token: string | undefined;
  chatIds: string[];
}

/** Token from the environment; chats from Settings plus the optional TELEGRAM_CHAT_ID fallback. */
export function telegramConfig(settings: AppSettings, env: Record<string, string | undefined> = process.env): TelegramConfig {
  const chatIds = [...new Set([...settings.telegram.chatIds, ...parseChatIds(env.TELEGRAM_CHAT_ID)])];
  return { token: env.TELEGRAM_BOT_TOKEN?.trim() || undefined, chatIds };
}

export function telegramConfigured(cfg: TelegramConfig): cfg is { token: string; chatIds: string[] } {
  return Boolean(cfg.token) && cfg.chatIds.length > 0;
}

/** Sends one message to every configured chat. Never throws; failures are returned and logged. */
export async function sendTelegram(
  cfg: TelegramConfig,
  html: string,
  fetchImpl: typeof fetch = fetch,
  replyMarkup?: InlineKeyboard,
): Promise<{ ok: boolean; errors: string[] }> {
  if (!cfg.token) return { ok: false, errors: ["TELEGRAM_BOT_TOKEN is not set."] };
  if (!cfg.chatIds.length) return { ok: false, errors: ["Add at least one chat ID."] };
  const errors: string[] = [];
  await Promise.all(
    cfg.chatIds.map(async (chatId) => {
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: html,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { description?: string };
          errors.push(`chat ${chatId}: ${body.description ?? `HTTP ${res.status}`}`);
        }
      } catch (e) {
        errors.push(`chat ${chatId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  if (errors.length) console.warn("[telegram] send failed", errors.join("; "));
  return { ok: errors.length === 0, errors };
}

export interface TelegramChat {
  id: string;
  title: string;
  type: string;
}

/**
 * Lists chats that recently messaged the bot (send /start first). Reads updates
 * without confirming them, so a bot also used elsewhere keeps its updates.
 */
export async function findTelegramChats(token: string, fetchImpl: typeof fetch = fetch): Promise<TelegramChat[]> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0`, { signal: AbortSignal.timeout(8_000) });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message?: { chat?: Record<string, unknown> }; my_chat_member?: { chat?: Record<string, unknown> }; channel_post?: { chat?: Record<string, unknown> } }[];
  };
  if (res.status === 409) throw new Error("This bot uses a webhook, so chats can't be listed here. Get the chat ID from @userinfobot (or @getidsbot for groups) instead.");
  if (!body.ok) throw new Error(body.description ?? `Telegram returned HTTP ${res.status}`);
  const chats = new Map<string, TelegramChat>();
  for (const u of body.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (!chat || chat.id === undefined) continue;
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.title as string) || (chat.username as string) || "Chat";
    chats.set(String(chat.id), { id: String(chat.id), title: String(name), type: String(chat.type ?? "") });
  }
  return [...chats.values()];
}

/** Forwards a notification when Telegram is configured and that event type is switched on. */
export async function forwardNotification(
  input: NotificationInput,
  opts: { settings: AppSettings; baseUrl: string; config?: TelegramConfig; fetchImpl?: typeof fetch },
): Promise<void> {
  const event = telegramEventFor(input.kind);
  const tg = opts.settings.telegram;
  if (!event || !tg.enabled || !tg.events[event]) return;
  const cfg = opts.config ?? telegramConfig(opts.settings);
  if (!telegramConfigured(cfg)) return;
  await sendTelegram(cfg, formatTelegramMessage(input, opts.baseUrl), opts.fetchImpl, tg.actionButtons ? alertKeyboard(input) : undefined);
}

// --- Action buttons: webhook management and replies ----------------------------------

/** Secret Telegram sends in X-Telegram-Bot-Api-Secret-Token, derived from APP_ENCRYPTION_KEY. */
export function telegramWebhookSecret(encryptionKey = process.env.APP_ENCRYPTION_KEY ?? ""): string {
  return createHmac("sha256", encryptionKey).update("telegram-webhook-v1").digest("hex");
}

async function botCall<T = unknown>(token: string, method: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed (HTTP ${res.status})`);
  return json.result as T;
}

/** Points the bot at /api/webhooks/telegram so button taps reach this app. */
export function setTelegramWebhook(token: string, url: string, secret: string, fetchImpl?: typeof fetch) {
  return botCall(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query", "message", "my_chat_member"] }, fetchImpl);
}

export function deleteTelegramWebhook(token: string, fetchImpl?: typeof fetch) {
  return botCall(token, "deleteWebhook", { drop_pending_updates: false }, fetchImpl);
}

export function getTelegramWebhookInfo(token: string, fetchImpl?: typeof fetch) {
  return botCall<{ url?: string; pending_update_count?: number; last_error_message?: string }>(token, "getWebhookInfo", {}, fetchImpl);
}

export function answerButton(token: string, callbackQueryId: string, text: string, fetchImpl?: typeof fetch) {
  return botCall(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text: text.slice(0, 190) }, fetchImpl);
}

export function replaceButtons(token: string, chatId: string | number, messageId: number, markup: InlineKeyboard, fetchImpl?: typeof fetch) {
  return botCall(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup }, fetchImpl);
}

export function replyInChat(token: string, chatId: string | number, replyTo: number | null, html: string, fetchImpl?: typeof fetch) {
  return botCall(
    token,
    "sendMessage",
    { chat_id: chatId, text: html, parse_mode: "HTML", ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) },
    fetchImpl,
  );
}

export { escapeHtml };
