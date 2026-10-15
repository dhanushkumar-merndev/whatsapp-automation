import {
  answerButton,
  BUTTON_ACTIONS,
  chatKeyboard,
  escapeHtml,
  replaceButtons,
  replyInChat,
  telegramConfig,
  type ButtonCode,
} from "@/lib/notify/telegram";
import type { AppSettings } from "@/lib/settings/schema";
import { applyChatAction, CHAT_ACTION_LABELS } from "./conversation-control";
import type { PipelineDeps } from "./process-conversation";

/**
 * One update from Telegram (via /api/webhooks/telegram): a tap on an alert
 * button, or a message to the bot (remembered so "Find chat IDs" still works).
 * Only chats saved in Settings may control the bot.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

export interface TelegramUpdateContext {
  deps: PipelineDeps;
  settings: AppSettings;
  token: string;
  fetchImpl?: typeof fetch;
  rememberChat?: (chat: { id: string; title: string; type: string }) => Promise<void>;
  audit?: (action: string, conversationId: string, detail: Record<string, unknown>) => Promise<void>;
}

const ICONS = { bot_on: "🤖", restart: "🔁", human: "🙋", close: "✖️" } as const;

export async function handleTelegramUpdate(update: unknown, ctx: TelegramUpdateContext): Promise<string> {
  const u = obj(update);
  const f = ctx.fetchImpl;

  const message = obj(u.message ?? u.my_chat_member);
  const chat = obj(message.chat);
  if (chat.id !== undefined && !u.callback_query) {
    const id = String(chat.id);
    const title = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || String(chat.title ?? chat.username ?? "Chat");
    await ctx.rememberChat?.({ id, title, type: String(chat.type ?? "") });
    if (typeof message.text === "string" && message.text.startsWith("/start")) {
      await replyInChat(ctx.token, id, null, `👋 Your chat ID is <code>${escapeHtml(id)}</code>. Add it in the dashboard: Settings → Telegram alerts.`, f);
    }
    return "chat_seen";
  }

  const cq = obj(u.callback_query);
  if (typeof cq.id !== "string") return "ignored";
  const cqMessage = obj(cq.message);
  const chatId = String(obj(cqMessage.chat).id ?? "");
  if (!telegramConfig(ctx.settings).chatIds.includes(chatId)) {
    await answerButton(ctx.token, cq.id, "This chat isn't allowed to control the bot. Add its ID in Settings → Telegram alerts.", f);
    return "forbidden";
  }
  const m = /^([rshc]):([0-9a-f-]{36})$/.exec(String(cq.data ?? ""));
  if (!m) {
    await answerButton(ctx.token, cq.id, "This button is no longer valid.", f);
    return "unknown_button";
  }
  const action = BUTTON_ACTIONS[m[1] as ButtonCode];
  const conversationId = m[2];
  const result = await applyChatAction(ctx.deps, conversationId, action, "telegram");
  const from = obj(cq.from);
  const who = String(from.first_name ?? from.username ?? "someone");
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: ctx.settings.business.timezone, hour: "numeric", minute: "2-digit" }).format(ctx.deps.now());

  await answerButton(ctx.token, cq.id, result.message, f);
  await replyInChat(
    ctx.token,
    chatId,
    typeof cqMessage.message_id === "number" ? cqMessage.message_id : null,
    `${result.ok ? ICONS[action] : "⚠️"} <b>${escapeHtml(CHAT_ACTION_LABELS[action])}</b> by ${escapeHtml(who)} · ${escapeHtml(time)}\n${escapeHtml(result.message)}`,
    f,
  );
  if (typeof cqMessage.message_id === "number") {
    // Show what can be done next: hand back while a person has it, take over while the bot has it.
    const withPerson = action === "human" || action === "close" || !result.ok;
    await replaceButtons(ctx.token, chatId, cqMessage.message_id, chatKeyboard(conversationId, withPerson), f).catch(() => undefined);
  }
  await ctx.audit?.(`conversation.${action}`, conversationId, { via: "telegram", telegramUser: who, ok: result.ok });
  return action;
}
