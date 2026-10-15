import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";
import { applyChatAction } from "@/lib/core/conversation-control";

const CUSTOMER = "919876543210";

/** Webhook for a message the business sent from the WhatsApp Business app. */
function echo(h: ReturnType<typeof createHarness>, text: string, id = `wamid.echo.${Math.random()}`) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA1",
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: "PN1" },
              message_echoes: [{ from: "15550001111", to: CUSTOMER, id, timestamp: String(Math.floor(h.clock.now().getTime() / 1000)), type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

const conv = (h: ReturnType<typeof createHarness>) => [...h.store.conversations.values()][0];

describe("Coexistence — replying from the WhatsApp Business app", () => {
  it("hands the chat to a person, stops the running flow and alerts the team once", async () => {
    const h = createHarness();
    await h.say("Hi");
    expect(h.execution().status).toBe("waiting_delay");

    await h.deliver(echo(h, "Hi Asha, this is Ravi from the team"));
    expect(conv(h).status).toBe("handoff");
    expect(conv(h).handoffBy).toBe("business_app");
    expect(h.execution().status).toBe("handoff");
    expect(h.scheduler.cancelled).toHaveLength(1);
    expect(h.store.notifications.filter((n) => n.kind === "handoff_app")).toHaveLength(1);
    const stored = h.store.messages.find((m) => m.source === "business_app")!;
    expect(stored).toMatchObject({ direction: "outbound", body: "Hi Asha, this is Ravi from the team", status: "sent" });

    // Further phone replies don't alert again; the customer's replies are not answered by the bot.
    await h.deliver(echo(h, "Shall I call you?"));
    expect(h.store.notifications.filter((n) => n.kind === "handoff_app")).toHaveLength(1);
    const sent = h.sender.sent.length;
    await h.say("Yes please");
    expect(h.sender.sent.length).toBe(sent);
    expect(h.store.notifications.some((n) => n.kind === "handoff_message")).toBe(true);
  });

  it("ignores duplicate echoes and keeps the bot running when Settings say so", async () => {
    const h = createHarness({ settings: { coexistence: { onAppReply: "ignore", autoResumeHours: 0 } } as never });
    await h.say("Hi");
    await h.deliver(echo(h, "Quick note", "wamid.same"));
    await h.deliver(echo(h, "Quick note", "wamid.same"));
    expect(h.store.messages.filter((m) => m.source === "business_app")).toHaveLength(1);
    expect(conv(h).status).toBe("open");
    expect(h.execution().status).toBe("waiting_delay");
  });

  it("hands the chat back to the bot after the auto hand-back period", async () => {
    const h = createHarness({ settings: { coexistence: { onAppReply: "pause", autoResumeHours: 2 } } as never });
    await h.say("Hi");
    await h.deliver(echo(h, "Hello from the team"));
    h.clock.advance(3600);
    const before = h.sender.sent.length;
    await h.say("Thanks");
    expect(h.sender.sent.length).toBe(before); // still with the team
    h.clock.advance(2 * 3600);
    await h.say("Hello?");
    expect(conv(h).status).toBe("open");
    expect(h.sender.sent.length).toBeGreaterThan(before); // the bot answered
  });
});

describe("Coexistence — onboarding sync", () => {
  it("stores chat history without ever running a workflow", async () => {
    const h = createHarness();
    const ts = String(Math.floor(h.clock.now().getTime() / 1000) - 86_400 * 30);
    const r = await h.deliver({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "history",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550001111", phone_number_id: "PN1" },
                history: [
                  {
                    metadata: { phase: 0, chunk_order: 1, progress: 100 },
                    threads: [
                      {
                        id: CUSTOMER,
                        messages: [
                          { from: CUSTOMER, id: "wamid.h1", timestamp: ts, type: "text", text: { body: "Is the shop open on Sunday?" } },
                          { from: "15550001111", id: "wamid.h2", timestamp: ts, type: "text", text: { body: "Yes, 10 to 2" } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(r.history).toBe(2);
    expect(h.sender.sent).toHaveLength(0);
    expect(h.store.executions.size).toBe(0);
    expect(h.store.messages.map((m) => [m.direction, m.source, m.processingNote])).toEqual([
      ["inbound", "history", "history"],
      ["outbound", "history", null],
    ]);
    // A real message afterwards is answered normally.
    await h.say("Hi");
    expect(h.sender.texts()[0]).toContain("Welcome to Star Growth Hub!");
  });

  it("saves the names from the business's phone contacts", async () => {
    const h = createHarness();
    const r = await h.deliver({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "smb_app_state_sync",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "PN1" },
                state_sync: [
                  { type: "contact", contact: { full_name: "Asha Kumar", first_name: "Asha", phone_number: "+91 98765 43210" }, action: "add", metadata: { timestamp: "1" } },
                  { type: "contact", contact: { full_name: "Old", phone_number: "919800000000" }, action: "remove", metadata: { timestamp: "1" } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(r.contactsSynced).toBe(2);
    expect(h.store.businessContacts.get(CUSTOMER)).toEqual({ fullName: "Asha Kumar", firstName: "Asha" });
  });
});

describe("Chat buttons (dashboard / Telegram)", () => {
  it("Bot on, Keep with me and Restart flow now", async () => {
    const h = createHarness();
    await h.say("Hi");
    await h.deliver(echo(h, "Taking over"));
    const id = conv(h).id;

    expect((await applyChatAction(h.deps, id, "bot_on", "telegram")).ok).toBe(true);
    expect(conv(h).status).toBe("open");

    expect((await applyChatAction(h.deps, id, "human", "telegram")).message).toBe("The bot is paused for this chat.");
    expect(conv(h)).toMatchObject({ status: "handoff", handoffBy: "telegram" });

    const before = h.sender.sent.length;
    const r = await applyChatAction(h.deps, id, "restart", "telegram");
    expect(r).toMatchObject({ ok: true, message: "“Star Growth Hub — Enquiry” restarted for this customer." });
    expect(h.sender.sent.length).toBeGreaterThan(before);
    // The flow starts over (the brochure is skipped: already sent within 24 hours).
    expect(h.sender.texts().at(-1)).toContain("Welcome to Star Growth Hub!");
  });

  it("explains why a restart can't send after the 24-hour window", async () => {
    const h = createHarness();
    await h.say("Hi");
    h.clock.advance(25 * 3600);
    const r = await applyChatAction(h.deps, conv(h).id, "restart", "team");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("24-hour window has closed");
    expect(conv(h).status).toBe("open");
  });
});
