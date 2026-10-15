import type { AppStore, InboundRecordInput } from "./types";

/**
 * Parses a (signature-verified) Meta webhook payload and durably records it.
 * Only messages for an enabled, registered phone number of a matching WhatsApp
 * Business Account are accepted (checked by the database while recording).
 * Status receipts update messages and never start flows. Returns the
 * conversations that need processing.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Message types that are recorded but never drive automation. */
export const NON_ACTIONABLE_TYPES = new Set(["reaction", "system", "unsupported", "ephemeral", "errors", "unknown"]);

export interface IngestResult {
  conversations: string[];
  recorded: number;
  duplicates: number;
  statuses: number;
  ignored: number;
  /** New customer messages the bot will answer: mark read + show "typing…" right away. */
  typing: { phoneNumberId: string; waMessageId: string }[];
  /** Coexistence: chats just handed to a person because the business replied from the phone app. */
  takeovers: string[];
  echoes: number;
  history: number;
  contactsSynced: number;
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
      payload.interactive_type = str(i.type);
      if (i.nfm_reply) {
        // A submitted WhatsApp Form: its answers arrive as a JSON string.
        const nfm = obj(i.nfm_reply);
        try {
          payload.form_response = obj(JSON.parse(str(nfm.response_json) ?? "{}"));
        } catch {
          payload.form_response = {};
        }
        body = str(nfm.body) ?? "[form submitted]";
        break;
      }
      const reply = obj(i.button_reply ?? i.list_reply);
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
      payload.location = { latitude: l.latitude, longitude: l.longitude, name: str(l.name), address: str(l.address) };
      body = str(l.name) ? `[location] ${str(l.name)}` : "[location]";
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

const isoFromSeconds = (v: unknown) => {
  const ts = Number(v);
  return new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString();
};

/** Messages the business sent from the WhatsApp Business app (coexistence). */
async function ingestEchoes(store: AppStore, account: { phoneNumberId: string; wabaId: string }, value: Json, result: IngestResult) {
  for (const raw of arr(value.message_echoes)) {
    const m = obj(raw);
    const to = str(m.to);
    const id = str(m.id);
    if (!to || !id || !/^\d{6,20}$/.test(to)) {
      result.ignored++;
      continue;
    }
    const { type, body, payload } = extractInbound(m);
    const r = await store.recordBusinessEcho({ ...account, waId: to, waMessageId: id, type, body, payload, providerTimestamp: isoFromSeconds(m.timestamp) });
    if (r.ignored) {
      result.ignored++;
      continue;
    }
    if (!r.duplicate) result.echoes++;
    if (r.tookOver && !result.takeovers.includes(r.conversationId)) result.takeovers.push(r.conversationId);
  }
}

/** One chunk of chat history shared during onboarding: stored, never processed. */
async function ingestHistory(store: AppStore, account: { phoneNumberId: string; wabaId: string }, value: Json, result: IngestResult) {
  for (const chunk of arr(value.history)) {
    for (const t of arr(obj(chunk).threads)) {
      const thread = obj(t);
      const waId = str(thread.id);
      if (!waId || !/^\d{6,20}$/.test(waId)) continue;
      const messages = arr(thread.messages).flatMap((raw) => {
        const m = obj(raw);
        const id = str(m.id);
        if (!id) return [];
        const { type, body, payload } = extractInbound(m);
        return [{ direction: str(m.from) === waId ? ("inbound" as const) : ("outbound" as const), waMessageId: id, type, body, payload, providerTimestamp: isoFromSeconds(m.timestamp) }];
      });
      if (messages.length) result.history += await store.recordHistory({ ...account, waId, messages });
    }
  }
}

/** Names from the business's phone contacts. */
async function ingestContacts(store: AppStore, value: Json, result: IngestResult) {
  const contacts = arr(value.state_sync).flatMap((raw) => {
    const s = obj(raw);
    const c = obj(s.contact);
    const waId = (str(c.phone_number) ?? "").replace(/\D/g, "");
    if (str(s.type) !== "contact" || !/^\d{6,20}$/.test(waId)) return [];
    return [{ waId, fullName: str(c.full_name), firstName: str(c.first_name), action: str(s.action) === "remove" ? ("remove" as const) : ("add" as const) }];
  });
  if (contacts.length) result.contactsSynced += await store.syncBusinessContacts(contacts);
}

export async function ingestWebhook(deps: { store: AppStore; now?: () => Date }, payload: unknown): Promise<IngestResult> {
  const result: IngestResult = {
    conversations: [],
    recorded: 0,
    duplicates: 0,
    statuses: 0,
    ignored: 0,
    typing: [],
    takeovers: [],
    echoes: 0,
    history: 0,
    contactsSynced: 0,
  };
  const root = obj(payload);
  if (root.object !== "whatsapp_business_account") return result;
  const conversations = new Set<string>();
  const now = (deps.now ?? (() => new Date()))().getTime();

  for (const entryRaw of arr(root.entry)) {
    const entry = obj(entryRaw);
    const wabaId = str(entry.id);
    for (const changeRaw of arr(entry.changes)) {
      const change = obj(changeRaw);
      const value = obj(change.value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (change.field === "smb_app_state_sync") {
        await ingestContacts(deps.store, value, result);
        continue;
      }
      if (change.field !== "messages" && change.field !== "smb_message_echoes" && change.field !== "history") continue;
      if (!wabaId || !phoneNumberId) {
        result.ignored++;
        continue;
      }
      if (change.field === "smb_message_echoes") {
        await ingestEchoes(deps.store, { phoneNumberId, wabaId }, value, result);
        continue;
      }
      if (change.field === "history") {
        await ingestHistory(deps.store, { phoneNumberId, wabaId }, value, result);
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
          phoneNumberId,
          wabaId,
          waId: from,
          profileName: profiles.get(from) ?? null,
          waMessageId: id,
          type,
          body,
          payload: extra,
          providerTimestamp: new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString(),
          isTest: false,
        };
        const r = await deps.store.recordInbound(input);
        if (r.ignored) {
          result.ignored++;
          continue;
        }
        if (r.duplicate) {
          result.duplicates++;
        } else {
          result.recorded++;
          const automated =
            !NON_ACTIONABLE_TYPES.has(type) &&
            r.conversationStatus !== "handoff" &&
            !r.optedOut &&
            !(r.cooldownUntil && new Date(r.cooldownUntil).getTime() > now);
          if (automated) result.typing.push({ phoneNumberId, waMessageId: id });
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
        result.statuses++;
      }
    }
  }
  result.conversations = [...conversations];
  return result;
}
