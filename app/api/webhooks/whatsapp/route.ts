import { after, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { verifyMetaSignature } from "@/lib/whatsapp/signature";
import { ingestWebhook } from "@/lib/core/webhook-ingest";
import { processConversation } from "@/lib/core/process-conversation";
import { createPipelineDeps } from "@/lib/server/pipeline";
import { createLogger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 1_000_000;
const log = createLogger("webhook.whatsapp");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta webhook verification handshake. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token") ?? "";
  const challenge = p.get("hub.challenge") ?? "";
  if (mode === "subscribe" && safeEqual(token, serverEnv().META_WEBHOOK_VERIFY_TOKEN) && /^[\w-]{1,200}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Inbound events. Order of operations:
 *   1. verify X-Hub-Signature-256 over the raw body (reject otherwise)
 *   2. durably record messages / statuses (non-2xx on failure → Meta retries)
 *   3. acknowledge 200 immediately; process conversations after the response
 */
export async function POST(req: NextRequest) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

  const env = serverEnv();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
    log.warn("rejected webhook with invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const deps = await createPipelineDeps("webhook.whatsapp", { backgroundWrites: true });
  let result;
  try {
    result = await ingestWebhook({ store: deps.store, settings: deps.settings, expectedWabaId: env.META_WABA_ID }, payload);
  } catch (e) {
    log.error("failed to record webhook", { error: e instanceof Error ? e.message : String(e) });
    after(() => deps.store.flush());
    return new Response("Temporary failure", { status: 500 });
  }

  // Always registered: status-only events still leave usage counters to flush.
  after(async () => {
    for (const id of result.conversations) {
      try {
        await processConversation(deps, id);
      } catch (e) {
        log.error("conversation processing failed", { conversationId: id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await deps.store.flush();
  });
  return Response.json({ ok: true, recorded: result.recorded, duplicates: result.duplicates, statuses: result.statuses });
}
