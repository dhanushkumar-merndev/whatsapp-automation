import type { OutboundMessage } from "@/lib/engine/types";

/** Builds the Cloud API /messages request body for an outbound message. */
export function buildMessagePayload(to: string, message: OutboundMessage, mediaId?: string | null): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (message.kind) {
    case "text":
      return { ...base, type: "text", text: { preview_url: false, body: message.text.slice(0, 4096) } };
    case "media": {
      if (!mediaId) throw new Error("Media must be uploaded to Meta before sending");
      const media: Record<string, unknown> = { id: mediaId };
      if (message.caption) media.caption = message.caption.slice(0, 1024);
      if (message.mediaType === "document" && message.filename) media.filename = message.filename.slice(0, 240);
      return { ...base, type: message.mediaType, [message.mediaType]: media };
    }
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          ...(message.header ? { header: { type: "text", text: message.header } } : {}),
          body: { text: message.body },
          ...(message.footer ? { footer: { text: message.footer } } : {}),
          action: { buttons: message.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          ...(message.header ? { header: { type: "text", text: message.header } } : {}),
          body: { text: message.body },
          ...(message.footer ? { footer: { text: message.footer } } : {}),
          action: {
            button: message.buttonText.slice(0, 20),
            sections: [
              {
                title: "Options",
                rows: message.rows.map((r) => ({
                  id: r.id,
                  title: r.title.slice(0, 24),
                  ...(r.description ? { description: r.description.slice(0, 72) } : {}),
                })),
              },
            ],
          },
        },
      };
  }
}

/** Meta error codes → how the engine should react. */
export function classifyMetaError(status: number, code: number | undefined): { windowClosed: boolean; transient: boolean } {
  if (code === 131047) return { windowClosed: true, transient: false }; // re-engagement: >24h since last customer message
  if (status === 429 || status >= 500) return { windowClosed: false, transient: true };
  if (code !== undefined && [1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056].includes(code)) {
    return { windowClosed: false, transient: true };
  }
  return { windowClosed: false, transient: false };
}
