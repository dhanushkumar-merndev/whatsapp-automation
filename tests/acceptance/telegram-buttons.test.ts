import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHarness } from "../helpers/harness";
import { alertKeyboard, forwardNotification, telegramWebhookSecret } from "@/lib/notify/telegram";
import { handleTelegramUpdate } from "@/lib/core/telegram-update";
import { appSettingsSchema, type AppSettings } from "@/lib/settings/schema";

const TOKEN = "123456:TEST-token";

function fakeFetch() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: String(url).split("/").pop()!, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

function withTelegram(h: ReturnType<typeof createHarness>): AppSettings {
  return { ...h.settings, telegram: { ...h.settings.telegram, chatIds: ["111"], actionButtons: true } };
}

const tap = (data: string, chatId = 111) => ({
  update_id: 1,
  callback_query: { id: "cb1", from: { id: 7, first_name: "Dhanush" }, message: { message_id: 55, chat: { id: chatId, type: "private" } }, data },
});

describe("Telegram action buttons", () => {
  it("adds the right buttons to each kind of alert", () => {
    const conv = "11111111-1111-4111-8111-111111111111";
    const kb = (kind: string) => alertKeyboard({ kind, severity: "info", title: "t", conversationId: conv })?.inline_keyboard.flat().map((b) => b.callback_data);
    expect(kb("handoff_app")).toEqual([`r:${conv}`, `s:${conv}`, `c:${conv}`]);
    expect(kb("lead_submitted")).toEqual([`h:${conv}`]);
    expect(kb("crm_failed")).toBeUndefined();
    expect(alertKeyboard({ kind: "handoff", severity: "info", title: "t" })).toBeUndefined();
  });

  it("sends buttons only when they are switched on", async () => {
    const base = appSettingsSchema.parse({});
    const input = { kind: "handoff", severity: "warning" as const, title: "Help", conversationId: "11111111-1111-4111-8111-111111111111" };
    const off = fakeFetch();
    await forwardNotification(input, { settings: { ...base, telegram: { ...base.telegram, chatIds: ["111"] } }, baseUrl: "https://x", config: { token: TOKEN, chatIds: ["111"] }, fetchImpl: off.impl });
    expect(off.calls[0].body.reply_markup).toBeUndefined();
    const on = fakeFetch();
    await forwardNotification(input, { settings: { ...base, telegram: { ...base.telegram, chatIds: ["111"], actionButtons: true } }, baseUrl: "https://x", config: { token: TOKEN, chatIds: ["111"] }, fetchImpl: on.impl });
    expect(on.calls[0].body.reply_markup).toMatchObject({ inline_keyboard: [[{ text: "🤖 Bot on" }, { text: "🔁 Restart flow" }], [{ text: "✖️ Close chat" }]] });
  });

  it("“Bot on” from an allowed chat hands the chat back and reports who did it", async () => {
    const h = createHarness();
    await h.say("Hi");
    await h.say("human");
    const id = [...h.store.conversations.values()][0].id;
    const { impl, calls } = fakeFetch();
    const audited: string[] = [];
    const r = await handleTelegramUpdate(tap(`r:${id}`), { deps: h.deps, settings: withTelegram(h), token: TOKEN, fetchImpl: impl, audit: async (a) => void audited.push(a) });
    expect(r).toBe("bot_on");
    expect([...h.store.conversations.values()][0].status).toBe("open");
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "sendMessage", "editMessageReplyMarkup"]);
    expect(String(calls[1].body.text)).toContain("<b>Bot on</b> by Dhanush");
    expect(calls[2].body.reply_markup).toMatchObject({ inline_keyboard: [[{ text: "🙋 Take over", callback_data: `h:${id}` }]] });
    expect(audited).toEqual(["conversation.bot_on"]);

    // And the bot answers the customer again.
    const before = h.sender.sent.length;
    h.clock.advance(60);
    await h.say("Hello again");
    expect(h.sender.sent.length).toBeGreaterThan(before);
  });

  it("ignores taps from chats that aren't in Settings, and unknown buttons", async () => {
    const h = createHarness();
    await h.say("Hi");
    const id = [...h.store.conversations.values()][0].id;
    const { impl, calls } = fakeFetch();
    expect(await handleTelegramUpdate(tap(`h:${id}`, 999), { deps: h.deps, settings: withTelegram(h), token: TOKEN, fetchImpl: impl })).toBe("forbidden");
    expect([...h.store.conversations.values()][0].status).toBe("open");
    expect(calls).toHaveLength(1);
    expect(await handleTelegramUpdate(tap("x:nope"), { deps: h.deps, settings: withTelegram(h), token: TOKEN, fetchImpl: impl })).toBe("unknown_button");
  });

  it("remembers chats that message the bot and tells them their chat ID", async () => {
    const h = createHarness();
    const { impl, calls } = fakeFetch();
    const seen: { id: string; title: string }[] = [];
    const r = await handleTelegramUpdate(
      { update_id: 2, message: { message_id: 1, text: "/start", chat: { id: -100123, type: "group", title: "Sales team" } } },
      { deps: h.deps, settings: withTelegram(h), token: TOKEN, fetchImpl: impl, rememberChat: async (c) => void seen.push(c) },
    );
    expect(r).toBe("chat_seen");
    expect(seen).toEqual([{ id: "-100123", title: "Sales team", type: "group" }]);
    expect(String(calls[0].body.text)).toContain("<code>-100123</code>");
  });
});

describe("Telegram webhook endpoint", () => {
  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  });

  it("rejects requests without the secret token", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/webhooks/telegram/route");
    const res = await POST(new NextRequest("https://app.example.com/api/webhooks/telegram", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "wrong" } }));
    expect(res.status).toBe(401);
    expect(telegramWebhookSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});
