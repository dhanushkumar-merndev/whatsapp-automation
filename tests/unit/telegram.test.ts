import { describe, expect, it } from "vitest";
import {
  findTelegramChats,
  formatTelegramMessage,
  forwardNotification,
  parseChatIds,
  sendTelegram,
  telegramConfig,
  telegramEventFor,
} from "@/lib/notify/telegram";
import { appSettingsSchema, type AppSettings } from "@/lib/settings/schema";
import type { NotificationInput } from "@/lib/engine/types";

const BASE = "https://sgh-whatsapp.vercel.app";
const TOKEN = "123456:TEST-token";

function settings(patch: Partial<AppSettings["telegram"]> = {}): AppSettings {
  const s = appSettingsSchema.parse({});
  return { ...s, telegram: { ...s.telegram, chatIds: ["111"], ...patch } };
}

function fakeFetch(status = 200, body: unknown = { ok: true }) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

const handoff: NotificationInput = {
  kind: "handoff",
  severity: "warning",
  title: "Human assistance requested by +919876543210",
  body: "I want to talk to <someone> & now",
  link: "/conversations/abc",
};

describe("Telegram alerts", () => {
  it("maps notification kinds to the alert switches", () => {
    expect(telegramEventFor("handoff")).toBe("handoff");
    expect(telegramEventFor("handoff_message")).toBe("handoffMessages");
    expect(telegramEventFor("lead_submitted")).toBe("leads");
    expect(telegramEventFor("crm_failed")).toBe("problems");
    expect(telegramEventFor("window_expired")).toBe("problems");
    expect(telegramEventFor("abuse_cooldown")).toBeNull();
  });

  it("formats an escaped HTML message with a dashboard link", () => {
    const html = formatTelegramMessage(handoff, `${BASE}/`);
    expect(html).toContain("🙋 <b>Human assistance requested by +919876543210</b>");
    expect(html).toContain("I want to talk to &lt;someone&gt; &amp; now");
    expect(html).toContain(`<a href="${BASE}/conversations/abc">Open in dashboard</a>`);
  });

  it("accepts user, group and channel chat IDs and ignores junk", () => {
    expect(parseChatIds("123, -1001234567890\n@star_alerts nonsense 12a")).toEqual(["123", "-1001234567890", "@star_alerts"]);
  });

  it("merges chats from Settings with the TELEGRAM_CHAT_ID fallback", () => {
    const cfg = telegramConfig(settings({ chatIds: ["111"] }), { TELEGRAM_BOT_TOKEN: ` ${TOKEN} `, TELEGRAM_CHAT_ID: "111,222" });
    expect(cfg).toEqual({ token: TOKEN, chatIds: ["111", "222"] });
  });

  it("sends to every chat and reports Telegram errors without throwing", async () => {
    const ok = fakeFetch();
    const r = await sendTelegram({ token: TOKEN, chatIds: ["111", "222"] }, "hi", ok.impl);
    expect(r.ok).toBe(true);
    expect(ok.calls.map((c) => c.body?.chat_id)).toEqual(["111", "222"]);
    expect(ok.calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(ok.calls[0].body).toMatchObject({ parse_mode: "HTML", text: "hi" });

    const bad = fakeFetch(400, { ok: false, description: "Bad Request: chat not found" });
    const failed = await sendTelegram({ token: TOKEN, chatIds: ["999"] }, "hi", bad.impl);
    expect(failed).toEqual({ ok: false, errors: ["chat 999: Bad Request: chat not found"] });

    expect((await sendTelegram({ token: undefined, chatIds: ["1"] }, "hi", ok.impl)).ok).toBe(false);
  });

  it("forwards only switched-on events when a token and chat are configured", async () => {
    const config = { token: TOKEN, chatIds: ["111"] };
    const f = fakeFetch();
    await forwardNotification(handoff, { settings: settings(), baseUrl: BASE, config, fetchImpl: f.impl });
    expect(f.calls).toHaveLength(1);

    await forwardNotification(handoff, { settings: settings({ enabled: false }), baseUrl: BASE, config, fetchImpl: f.impl });
    const s = settings();
    await forwardNotification(handoff, { settings: { ...s, telegram: { ...s.telegram, events: { ...s.telegram.events, handoff: false } } }, baseUrl: BASE, config, fetchImpl: f.impl });
    await forwardNotification({ ...handoff, kind: "abuse_cooldown" }, { settings: s, baseUrl: BASE, config, fetchImpl: f.impl });
    await forwardNotification(handoff, { settings: s, baseUrl: BASE, config: { token: undefined, chatIds: ["111"] }, fetchImpl: f.impl });
    expect(f.calls).toHaveLength(1);
  });

  it("lists chats that messaged the bot and explains webhook bots", async () => {
    const updates = fakeFetch(200, {
      ok: true,
      result: [
        { message: { chat: { id: 111, type: "private", first_name: "Gayathri" } } },
        { message: { chat: { id: 111, type: "private", first_name: "Gayathri" } } },
        { my_chat_member: { chat: { id: -1001234567890, type: "supergroup", title: "SGH Team" } } },
      ],
    });
    expect(await findTelegramChats(TOKEN, updates.impl)).toEqual([
      { id: "111", title: "Gayathri", type: "private" },
      { id: "-1001234567890", title: "SGH Team", type: "supergroup" },
    ]);
    // Updates are read without an offset, so they are not confirmed (other users of the bot keep them).
    expect(updates.calls[0].url).not.toContain("offset");

    const webhook = fakeFetch(409, { ok: false, description: "Conflict: can't use getUpdates method while webhook is active" });
    await expect(findTelegramChats(TOKEN, webhook.impl)).rejects.toThrow(/userinfobot/);
  });
});
