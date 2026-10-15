import { after, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { verifyMetaSignature } from "@/lib/whatsapp/signature";
import { ingestWebhook } from "@/lib/core/webhook-ingest";
import type { PipelineDeps } from "@/lib/core/process-conversation";
import { processIngested } from "@/lib/core/conversation-control";
import { createPipelineDeps, createSender, createStore } from "@/lib/server/pipeline";
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

  // Record the messages while the settings load: neither waits for the other.
  const store = createStore({ backgroundWrites: true });
  const sender = createSender();
  const depsPromise = createPipelineDeps("webhook.whatsapp", {}, { store, sender });
  depsPromise.catch(() => undefined); // awaited (and reported) in after()
  let result;
  try {
    result = await ingestWebhook({ store }, payload);
  } catch (e) {
    log.error("failed to record webhook", { error: e instanceof Error ? e.message : String(e) });
    after(() => store.flush());
    return new Response("Temporary failure", { status: 500 });
  }

  after(async () => {
    // "typing…" first, so the customer sees a reaction within about a second.
    const typing = Promise.all(
      result.typing.map(async (t) => {
        try {
          await sender.markRead?.(t);
        } catch (e) {
          log.warn("typing indicator failed", { error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
    const base = await depsPromise;
    // Replies wait for the typing call so it can never land after the answer.
    const deps: PipelineDeps = {
      ...base,
      sender: {
        send: async (input) => {
          await typing;
          return sender.send(input);
        },
        markRead: sender.markRead?.bind(sender),
      },
    };
    await processIngested(deps, result, (conversationId, e) =>
      log.error("conversation processing failed", { conversationId, error: e instanceof Error ? e.message : String(e) }),
    );
    await typing;
    await store.flush();
  });
  return Response.json({ ok: true, recorded: result.recorded, duplicates: result.duplicates, statuses: result.statuses });
}
