let counter = 0;

export interface InboundSpec {
  from?: string;
  text?: string;
  replyId?: string;
  replyTitle?: string;
  /** The message a tap answers (its wamid). */
  contextId?: string;
  type?: string;
  id?: string;
  timestamp?: Date;
  name?: string;
  /** Body of a non-text message, e.g. { id, mime_type } for an image or { latitude, longitude } for a location. */
  content?: Record<string, unknown>;
}

/** Builds a realistic Meta WhatsApp Cloud API webhook payload. */
export function metaInboundPayload(
  specs: InboundSpec[],
  opts: { wabaId?: string; phoneNumberId?: string } = {},
) {
  const messages = specs.map((s) => {
    const id = s.id ?? `wamid.TEST${++counter}`;
    const base = {
      from: s.from ?? "919876543210",
      id,
      timestamp: String(Math.floor((s.timestamp ?? new Date()).getTime() / 1000)),
    };
    if (s.replyId) {
      return {
        ...base,
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: s.replyId, title: s.replyTitle ?? s.replyId } },
        ...(s.contextId ? { context: { from: "15550000000", id: s.contextId } } : {}),
      };
    }
    if (s.type && s.type !== "text") return { ...base, type: s.type, [s.type]: s.content ?? {} };
    return { ...base, type: "text", text: { body: s.text ?? "" } };
  });
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: opts.wabaId ?? "WABA1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: opts.phoneNumberId ?? "PN1" },
              contacts: specs.map((s) => ({ profile: { name: s.name ?? "Asha" }, wa_id: s.from ?? "919876543210" })),
              messages,
            },
          },
        ],
      },
    ],
  };
}

export function metaStatusPayload(waMessageId: string, status: string, opts: { billable?: boolean } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PN1" },
              statuses: [
                {
                  id: waMessageId,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: "919876543210",
                  pricing: { billable: opts.billable ?? false, pricing_model: "PMP", category: "service" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
