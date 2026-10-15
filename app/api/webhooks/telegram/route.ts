import { after, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { telegramWebhookSecret } from "@/lib/notify/telegram";
import { handleTelegramUpdate } from "@/lib/core/telegram-update";
import { createPipelineDeps } from "@/lib/server/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/auth/guard";
import { createLogger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger("webhook.telegram");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Telegram bot updates: alert button taps (Bot on, Restart flow, Take over,
 * Close) and messages to the bot. Authenticated by the secret token set with
 * setWebhook; always acknowledged quickly so Telegram doesn't resend.
 */
export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", telegramWebhookSecret())) {
    return new Response("Unauthorized", { status: 401 });
  }
  let update: unknown;
  try {
    update = JSON.parse((await req.text()).slice(0, 100_000));
  } catch {
    return Response.json({ ok: true });
  }

  after(async () => {
    const deps = await createPipelineDeps("webhook.telegram", { backgroundWrites: true });
    try {
      await handleTelegramUpdate(update, {
        deps,
        settings: deps.settings,
        token,
        rememberChat: async (chat) => {
          await createAdminClient()
            .from("telegram_chats")
            .upsert({ id: chat.id, title: chat.title.slice(0, 200), type: chat.type.slice(0, 40), last_seen_at: new Date().toISOString() });
        },
        audit: (action, conversationId, detail) => audit(null, action, { type: "conversation", id: conversationId }, detail),
      });
    } catch (e) {
      log.error("telegram update failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      await deps.store.flush();
    }
  });
  return Response.json({ ok: true });
}
