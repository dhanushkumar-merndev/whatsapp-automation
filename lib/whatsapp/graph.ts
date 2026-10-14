import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { SendError, type MediaAssetRecord, type MessageSender, type OutboundMessage } from "@/lib/engine/types";
import { buildMessagePayload, classifyMetaError } from "./payload";

const GRAPH = "https://graph.facebook.com";
const MEDIA_ID_TTL_MS = 29 * 24 * 3600 * 1000; // Meta keeps uploaded media for 30 days

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string; error_data?: { details?: string } };
}

function graphUrl(path: string) {
  const env = serverEnv();
  return `${GRAPH}/${env.META_GRAPH_API_VERSION}/${path.replace(/^\//, "")}`;
}

async function graphFetch(path: string, init: RequestInit & { json?: unknown }, attempts = 2): Promise<Record<string, unknown>> {
  const env = serverEnv();
  if (!env.META_ACCESS_TOKEN) {
    throw new SendError("META_ACCESS_TOKEN is not configured — add the System User access token to the environment.", { transient: false });
  }
  let lastError: SendError | null = null;
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(graphUrl(path), {
        ...init,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        headers: {
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
          ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch (e) {
      lastError = new SendError(`Network error calling WhatsApp: ${e instanceof Error ? e.message : String(e)}`, { transient: true });
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & GraphError;
    if (res.ok) return body;
    const code = body.error?.code;
    const cls = classifyMetaError(res.status, code);
    const detail = body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${res.status}`;
    lastError = new SendError(`WhatsApp API error${code ? ` ${code}` : ""}: ${detail}`, { code, ...cls });
    if (!cls.transient) break;
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  throw lastError ?? new SendError("WhatsApp API request failed");
}

/** Uploads a private Supabase Storage file to Meta and caches the media id (no public URL needed). */
async function ensureMetaMediaId(asset: MediaAssetRecord, phoneNumberId: string): Promise<string> {
  const fresh =
    asset.metaMediaId &&
    asset.metaPhoneNumberId === phoneNumberId &&
    asset.metaMediaUploadedAt &&
    Date.now() - new Date(asset.metaMediaUploadedAt).getTime() < MEDIA_ID_TTL_MS;
  if (fresh) return asset.metaMediaId!;

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from("media").download(asset.storagePath);
  if (error || !blob) throw new SendError(`Could not read media file: ${error?.message ?? "missing"}`);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", asset.mimeType);
  form.append("file", new Blob([await blob.arrayBuffer()], { type: asset.mimeType }), asset.name);
  const res = await graphFetch(`${phoneNumberId}/media`, { method: "POST", body: form });
  const id = typeof res.id === "string" ? res.id : null;
  if (!id) throw new SendError("Meta did not return a media id");
  await admin
    .from("media_assets")
    .update({ meta_media_id: id, meta_media_uploaded_at: new Date().toISOString(), meta_phone_number_id: phoneNumberId })
    .eq("id", asset.id);
  return id;
}

/** Sends messages through the official WhatsApp Cloud API. */
export class MetaSender implements MessageSender {
  async send(input: { to: string; phoneNumberId: string; message: OutboundMessage; asset?: MediaAssetRecord | null }) {
    let mediaId: string | null = null;
    if (input.message.kind === "media") {
      if (!input.asset) throw new SendError("Media asset not found");
      mediaId = await ensureMetaMediaId(input.asset, input.phoneNumberId);
    }
    const payload = buildMessagePayload(input.to, input.message, mediaId);
    const res = await graphFetch(`${input.phoneNumberId}/messages`, { method: "POST", json: payload });
    const id = (res.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (!id) throw new SendError("WhatsApp API returned no message id");
    return { waMessageId: id };
  }
}

/** Reads phone number details for the WhatsApp Accounts page ("Test connection"). */
export async function fetchPhoneNumberInfo(phoneNumberId: string) {
  const res = await graphFetch(
    `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput`,
    { method: "GET" },
    1,
  );
  return res as {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
    platform_type?: string;
    throughput?: { level?: string };
  };
}
