import type { AppSettings } from "@/lib/settings/schema";
import type { AppStore, InboundRecordInput } from "./types";

/**
 * Parses a (signature-verified) Meta webhook payload and durably records it.
 * Only events for the configured WhatsApp Business Account and an enabled,
 * registered phone number are accepted. Status receipts update messages and
 * never start flows. Returns the conversations that need processing.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export interface IngestResult {
  conversations: string[];
  recorded: number;
  duplicates: number;
  statuses: number;
  ignored: number;
}

export function extractInbound(m: Json): { type: string; body: string | null; payload: Json } {
  const type = str(m.type) ?? "unknown";
  const payload: Json = {};
  let body: string | null = null;
  switch (type) {
    case "text":
      body = str(obj(m.text).body);
      break;
    case "interactive": {
      const i = obj(m.interactive);
      const reply = obj(i.button_reply ?? i.list_reply ?? i.nfm_reply);
      payload.interactive_type = str(i.type);
      payload.reply_id = str(reply.id);
      payload.reply_title = str(reply.title);
      body = str(reply.title);
      break;
    }
    case "button": {
      const b = obj(m.button);
      payload.reply_id = str(b.payload);
      payload.reply_title = str(b.text);
      body = str(b.text);
      break;
    }
    case "image":
    case "document":
    case "video":
    case "audio":
    case "sticker": {
      const media = obj(m[type]);
      payload.media_id = str(media.id);
      payload.mime_type = str(media.mime_type);
      payload.filename = str(media.filename);
      body = str(media.caption) ?? `[${type}]`;
      break;
    }
    case "location": {
      const l = obj(m.location);
      payload.location = { latitude: l.latitude, longitude: l.longitude, name: str(l.name) };
      body = "[location]";
      break;
    }
    case "reaction":
      payload.emoji = str(obj(m.reaction).emoji);
      body = null;
      break;
    default:
      body = null;
  }
  const context = obj(m.context);
  if (str(context.id)) payload.context_id = str(context.id);
  return { type, body: body ? body.slice(0, 4096) : null, payload };
}

export async function ingestWebhook(
  deps: { store: AppStore; settings: AppSettings; expectedWabaId: string },
  payload: unknown,
): Promise<IngestResult> {
  const result: IngestResult = { conversations: [], recorded: 0, duplicates: 0, statuses: 0, ignored: 0 };
  const root = obj(payload);
  if (root.object !== "whatsapp_business_account") return result;
  const conversations = new Set<string>();

  for (const entryRaw of arr(root.entry)) {
    const entry = obj(entryRaw);
    if (str(entry.id) !== deps.expectedWabaId) {
      result.ignored++;
      continue;
    }
    for (const changeRaw of arr(entry.changes)) {
      const change = obj(changeRaw);
      if (change.field !== "messages") continue;
      const value = obj(change.value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      const account = phoneNumberId ? await deps.store.getAccountByPhoneNumberId(phoneNumberId) : null;
      if (!account || !account.enabled || account.wabaId !== deps.expectedWabaId) {
        result.ignored++;
        continue;
      }

      const profiles = new Map<string, string | null>();
      for (const c of arr(value.contacts)) {
        const co = obj(c);
        const waId = str(co.wa_id);
        if (waId) profiles.set(waId, str(obj(co.profile).name));
      }

      for (const mRaw of arr(value.messages)) {
        const m = obj(mRaw);
        const from = str(m.from);
        const id = str(m.id);
        const ts = Number(m.timestamp);
        if (!from || !id || !/^\d{6,20}$/.test(from)) {
          result.ignored++;
          continue;
        }
        const { type, body, payload: extra } = extractInbound(m);
        const input: InboundRecordInput = {
          accountId: account.id,
          waId: from,
          profileName: profiles.get(from) ?? null,
          waMessageId: id,
          type,
          body,
          payload: extra,
          providerTimestamp: new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString(),
          isTest: deps.settings.testPhoneNumbers.includes(from),
        };
        const r = await deps.store.recordInbound(input);
        if (r.duplicate) {
          result.duplicates++;
        } else {
          result.recorded++;
          await deps.store.incrementUsage({ service: "whatsapp", metric: "messages_received", isTest: input.isTest });
        }
        conversations.add(r.conversationId);
      }

      for (const sRaw of arr(value.statuses)) {
        const s = obj(sRaw);
        const id = str(s.id);
        const status = str(s.status);
        if (!id || !status) continue;
        const pricing = obj(s.pricing);
        const errors = arr(s.errors);
        await deps.store.applyStatus({
          waMessageId: id,
          status,
          error: errors.length ? { errors } : null,
          billable: typeof pricing.billable === "boolean" ? pricing.billable : null,
          category: str(pricing.category),
          model: str(pricing.pricing_model),
        });
        if (status === "delivered" && pricing.billable === true) {
          await deps.store.incrementUsage({ service: "whatsapp", metric: "billable_messages", source: "provider" });
        }
        result.statuses++;
      }
    }
  }
  result.conversations = [...conversations];
  return result;
}
