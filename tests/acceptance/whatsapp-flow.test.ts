import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";
import { metaInboundPayload, metaStatusPayload } from "../helpers/meta";
import { buildDefaultFlowDefinition } from "@/lib/flows/default-flow";
import { SendError } from "@/lib/engine/types";

/** Drives the default Star Growth Hub flow up to the service question. */
async function reachServiceQuestion(h: ReturnType<typeof createHarness>) {
  await h.say("Hi");
  h.clock.advance(5);
  await h.runDueJobs();
  await h.say("Asha Kumar");
}

/** Runs the default flow to the end, leaving a qualified (open) lead. */
async function submitEnquiry(h: ReturnType<typeof createHarness>) {
  await reachServiceQuestion(h);
  await h.say("1");
  await h.say("Asha Studio");
  await h.say("More customers from Instagram");
}

const ALREADY_RECEIVED = "Hi Asha Kumar! We have already received your request. Our team will contact you soon.";

describe("Acceptance — customer-initiated WhatsApp automation", () => {
  it("4. the bot never initiates a conversation", async () => {
    const h = createHarness();
    // Nothing happens without an inbound customer message — even with active flows and due jobs.
    expect(await h.runDueJobs()).toEqual([]);
    expect(h.sender.sent).toHaveLength(0);
    expect(h.store.outbound()).toHaveLength(0);
    // Delivery/read receipts never start a flow.
    await h.deliver(metaStatusPayload("wamid.unknown", "delivered"));
    expect(h.sender.sent).toHaveLength(0);
    expect(h.store.executions.size).toBe(0);
  });

  it("5. a customer sending “Hi” receives the welcome message and the configured brochure", async () => {
    const h = createHarness();
    await h.say("Hi");
    expect(h.sender.sent).toHaveLength(2);
    expect(h.sender.sent[0].message).toMatchObject({ kind: "text" });
    expect(h.sender.texts()[0]).toContain("Welcome to Star Growth Hub!");
    expect(h.sender.sent[1].message).toMatchObject({ kind: "media", mediaType: "document", assetId: h.brochure!.id });
    expect(h.sender.sent.every((s) => s.to === "919876543210")).toBe(true);
  });

  it("6. the next question is scheduled through QStash about 5 seconds later", async () => {
    const h = createHarness();
    await h.say("Hi");
    expect(h.scheduler.scheduled).toHaveLength(1);
    expect(h.scheduler.scheduled[0].delaySeconds).toBe(5);
    expect(h.execution().status).toBe("waiting_delay");
    // Not yet due.
    await h.runDueJobs();
    expect(h.sender.texts()).not.toContain("May I know your name, please?");
    h.clock.advance(5);
    await h.runDueJobs();
    expect(h.sender.texts().at(-1)).toBe("May I know your name, please?");
    expect(h.execution().status).toBe("waiting_input");
  });

  it("7. a valid customer name is accepted and the service list follows", async () => {
    const h = createHarness();
    await reachServiceQuestion(h);
    const last = h.sender.sent.at(-1)!.message;
    expect(last.kind).toBe("list");
    if (last.kind === "list") {
      expect(last.body).toBe("Which service are you looking for?");
      expect(last.rows.map((r) => r.title)).toEqual([
        "Digital Marketing",
        "Social Media Management",
        "Meta & Google Ads",
        "Video Production",
        "Branding & Creative",
        "Other Services",
      ]);
    }
    expect(h.lead()?.name).toBe("Asha Kumar");
    expect(h.lead()?.status).toBe("incomplete");
  });

  it("7b. an invalid name is re-asked without advancing", async () => {
    const h = createHarness();
    await h.say("Hi");
    h.clock.advance(5);
    await h.runDueJobs();
    await h.say("1234");
    expect(h.sender.texts().at(-1)).toContain("Please share your name");
    expect(h.execution().awaiting).toMatchObject({ kind: "input", nodeId: "n_validate_name" });
  });

  it("8. an invalid service number triggers a retry without advancing the flow", async () => {
    const h = createHarness();
    await reachServiceQuestion(h);
    await h.say("9");
    expect(h.sender.texts().at(-1)).toBe("Sorry, that's not a valid option. Please select a number from 1 to 6.");
    expect(h.sender.texts()).not.toContain("Could you share your business name?");
    expect(h.execution().awaiting).toMatchObject({ kind: "input", nodeId: "n_validate_service" });
  });

  it("8b. three invalid attempts offer human assistance", async () => {
    const h = createHarness();
    await reachServiceQuestion(h);
    await h.say("9");
    await h.say("0");
    await h.say("banana");
    expect(h.sender.texts().at(-1)).toContain("connect you with our team");
    expect(h.execution().status).toBe("handoff");
    expect([...h.store.conversations.values()][0].status).toBe("handoff");
    expect(h.store.notifications.some((n) => n.kind === "handoff")).toBe(true);
  });

  it("9. a valid service selection (number, tap or title) continues the workflow", async () => {
    for (const answer of ["2", "tap", "social media management"]) {
      const h = createHarness();
      await reachServiceQuestion(h);
      if (answer === "tap") await h.select("svc_social_media", "Social Media Management");
      else await h.say(answer);
      expect(h.sender.texts().at(-1)).toBe("Could you share your business name?");
      expect(h.lead()?.service).toBe("Social Media Management");
      expect(h.lead()?.serviceId).toBe("svc_social_media");
    }
  });

  it("10. duplicate Meta webhooks do not send duplicate messages", async () => {
    const h = createHarness();
    const payload = metaInboundPayload([{ text: "Hi", id: "wamid.DUP1", timestamp: h.clock.now() }]);
    const first = await h.deliver(payload);
    const second = await h.deliver(payload);
    const third = await h.deliver(payload);
    expect(first.recorded).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(third.duplicates).toBe(1);
    expect(h.sender.sent).toHaveLength(2);
    expect(h.scheduler.scheduled).toHaveLength(1);
  });

  it("10b. duplicate QStash deliveries do not send the question twice", async () => {
    const h = createHarness();
    await h.say("Hi");
    h.clock.advance(5);
    const jobId = h.scheduler.scheduled[0].jobId;
    const { handleScheduledJob } = await import("@/lib/core/jobs");
    const a = await handleScheduledJob(h.deps, jobId, { retried: 0, lockWaitMs: 0 });
    const b = await handleScheduledJob(h.deps, jobId, { retried: 1, lockWaitMs: 0 });
    expect(a.status).toBe("done");
    expect(b.status).toBe("skipped");
    expect(h.sender.texts().filter((t) => t === "May I know your name, please?")).toHaveLength(1);
  });

  it("11. a customer replying hours later resumes the existing conversation", async () => {
    const h = createHarness();
    await reachServiceQuestion(h);
    h.clock.advance(5 * 3600);
    await h.say("3");
    expect(h.sender.texts().at(-1)).toBe("Could you share your business name?");
    expect(h.store.executions.size).toBe(1);
  });

  it("11b. a returning customer is recognised and not asked for their name again", async () => {
    const h = createHarness();
    await submitEnquiry(h);
    expect(h.execution().status).toBe("completed");
    const sentBefore = h.sender.sent.length;

    // The team has closed the earlier enquiry, so a new one may start.
    h.store.leads.get(h.lead()!.id)!.status = "won";
    h.clock.advance(3 * 24 * 3600);
    await h.say("Hello again");
    h.clock.advance(5);
    await h.runDueJobs();
    const newTexts = h.sender.texts().slice(sentBefore);
    expect(newTexts).toContain("Good to see you again, Asha Kumar!");
    expect(newTexts).not.toContain("May I know your name, please?");
  });

  it("11c. the brochure is not re-sent within the 24-hour cooldown", async () => {
    const h = createHarness();
    await h.say("Hi");
    await h.say("STOP");
    await h.say("START");
    h.clock.advance(3600);
    await h.say("Hi again");
    const docs = h.sender.sent.filter((s) => s.message.kind === "media");
    expect(docs).toHaveLength(1);
  });

  it("11d. a customer with an open enquiry is told it was received instead of starting again", async () => {
    const h = createHarness();
    await submitEnquiry(h);
    expect(h.lead()?.status).toBe("qualified");
    const sentBefore = h.sender.sent.length;
    const jobsBefore = h.scheduler.scheduled.length;

    h.clock.advance(3600);
    await h.say("Hi");
    const newTexts = h.sender.texts().slice(sentBefore);
    expect(newTexts).toHaveLength(1);
    expect(newTexts[0]).toContain(ALREADY_RECEIVED);
    expect(h.scheduler.scheduled).toHaveLength(jobsBefore);
    expect(h.execution().status).toBe("completed");

    // Further messages within the 12-hour cooldown get no automated reply.
    h.clock.advance(3600);
    await h.say("ok thanks");
    expect(h.sender.sent.length).toBe(sentBefore + 1);

    // After the cooldown the notice is sent again.
    h.clock.advance(12 * 3600);
    await h.say("Any update?");
    expect(h.sender.texts().slice(sentBefore).filter((t) => t.includes(ALREADY_RECEIVED))).toHaveLength(2);
  });

  it("11e. the enquiry questions start again once the open enquiry is older than 30 days", async () => {
    const h = createHarness();
    await submitEnquiry(h);
    const sentBefore = h.sender.sent.length;
    h.clock.advance(31 * 24 * 3600);
    await h.say("Hi");
    const newTexts = h.sender.texts().slice(sentBefore);
    expect(newTexts[0]).toContain("Welcome to Star Growth Hub!");
    expect(newTexts.some((t) => t.includes(ALREADY_RECEIVED))).toBe(false);
  });

  it("12. an expired 24-hour service window prevents free-form sends", async () => {
    const h = createHarness();
    await h.say("Hi");
    const before = h.sender.sent.length;
    h.clock.advance(25 * 3600);
    await h.runDueJobs();
    expect(h.sender.sent.length).toBe(before);
    expect(h.execution().status).toBe("window_expired");
    expect(h.store.notifications.some((n) => n.kind === "window_expired")).toBe(true);
  });

  it("12b. a Meta re-engagement error also closes the window safely", async () => {
    const h = createHarness();
    await h.say("Hi");
    h.clock.advance(5);
    h.sender.failNext = new SendError("Re-engagement message", { code: 131047, windowClosed: true });
    await h.runDueJobs();
    expect(h.execution().status).toBe("window_expired");
  });

  it("13 & 14. the captured lead is stored and the CRM webhook receives the correct data", async () => {
    const h = createHarness();
    const integration = h.store.addCrmIntegration({ url: "https://crm.example.com/hook" });
    await reachServiceQuestion(h);
    await h.say("2");
    await h.say("Asha Studio");
    await h.say("Grow online sales");

    const lead = h.lead()!;
    expect(lead).toMatchObject({
      name: "Asha Kumar",
      businessName: "Asha Studio",
      service: "Social Media Management",
      serviceId: "svc_social_media",
      requirements: "Grow online sales",
      phone: "919876543210",
      status: "qualified",
      crmSyncStatus: "synced",
    });
    expect(h.crm.calls).toHaveLength(1);
    const payload = h.crm.calls[0].delivery.payload as { event_id: string; event_type: string; data: Record<string, unknown> };
    expect(h.crm.calls[0].integration.id).toBe(integration.id);
    expect(payload.event_id).toBe(`lead.submitted:${lead.id}`);
    expect(payload.event_type).toBe("lead.submitted");
    expect(payload.data).toMatchObject({
      lead_id: lead.id,
      name: "Asha Kumar",
      phone: "+919876543210",
      business_name: "Asha Studio",
      service: "Social Media Management",
      requirements: "Grow online sales",
      source: "WhatsApp",
      status: "qualified",
      flow_id: h.flow.flowId,
      conversation_id: lead.conversationId,
    });
    expect(h.sender.texts().at(-1)).toBe(
      "Thank you for sharing your details. Our team will review your requirements and get in touch with you.",
    );
    expect(h.execution().status).toBe("completed");
  });

  it("15. failed CRM deliveries are retried safely without losing the lead", async () => {
    const h = createHarness();
    h.store.addCrmIntegration({ url: "https://crm.example.com/hook" });
    h.crm.responses.push({ ok: false, statusCode: 503, error: "Service Unavailable", responseExcerpt: null, durationMs: 3, retryable: true });
    await reachServiceQuestion(h);
    await h.say("1");
    await h.say("Asha Studio");
    await h.say("Leads");

    const lead = h.lead()!;
    expect(lead.status).toBe("qualified"); // saved locally first
    expect(lead.crmSyncStatus).toBe("pending");
    const delivery = [...h.store.crmDeliveries.values()][0];
    expect(delivery.status).toBe("retrying");
    // The customer still received the confirmation.
    expect(h.sender.texts().at(-1)).toContain("Thank you for sharing your details");

    h.clock.advance(120);
    await h.runDueJobs();
    expect([...h.store.crmDeliveries.values()][0].status).toBe("succeeded");
    expect(h.lead()!.crmSyncStatus).toBe("synced");
    expect(h.crm.calls).toHaveLength(2);
    // Same stable event id on every attempt (idempotent for the CRM).
    expect(new Set(h.crm.calls.map((c) => (c.delivery.payload as { event_id: string }).event_id)).size).toBe(1);
  });

  it("17. publishing a new version does not alter conversations already running", async () => {
    const h = createHarness();
    await h.say("Hi");
    const changed = buildDefaultFlowDefinition(h.brochure!.id);
    const ask = changed.nodes.find((n) => n.id === "n_ask_name")!;
    ask.data.config = { ...ask.data.config, question: "What's your name? (v2)" };
    h.store.publishVersion(h.flow.flowId, changed);

    h.clock.advance(5);
    await h.runDueJobs();
    expect(h.sender.texts().at(-1)).toBe("May I know your name, please?");

    // New conversations use the newly published version.
    await h.say("Hi", { from: "919811112222", name: "Ravi" });
    h.clock.advance(5);
    await h.runDueJobs();
    expect(h.sender.texts().at(-1)).toBe("What's your name? (v2)");
  });

  it("21. paused workflows stop automatic execution safely", async () => {
    const h = createHarness();
    await h.say("Hi");
    h.store.setFlowStatus(h.flow.flowId, "paused");
    const before = h.sender.sent.length;
    h.clock.advance(5);
    await h.runDueJobs();
    expect(h.sender.sent.length).toBe(before);
    expect(h.execution().status).toBe("paused");
    // New messages do not start the paused flow.
    await h.say("Hello?", { from: "919800000001" });
    expect(h.sender.sent.length).toBe(before);
  });
});

describe("Reliability and policy edge cases", () => {
  it("processes several quick messages in order without duplicate replies", async () => {
    const h = createHarness();
    await h.say("Hi");
    h.clock.advance(5);
    await h.runDueJobs();
    // Name and service arrive in one webhook batch.
    await h.deliver(
      metaInboundPayload([
        { text: "Asha Kumar", timestamp: h.clock.now() },
        { text: "2", timestamp: new Date(h.clock.now().getTime() + 1000) },
      ]),
    );
    const texts = h.sender.texts();
    expect(texts.filter((t) => t === "Which service are you looking for?")).toHaveLength(1);
    expect(texts.at(-1)).toBe("Could you share your business name?");
  });

  it("replies during a pending delay are recorded but do not advance the flow", async () => {
    const h = createHarness();
    await h.say("Hi");
    await h.say("Asha");
    const during = h.store.messages.find((m) => m.body === "Asha")!;
    expect(during.processingNote).toBe("received_during_delay");
    expect(h.execution().status).toBe("waiting_delay");
    h.clock.advance(5);
    await h.runDueJobs();
    expect(h.sender.texts().at(-1)).toBe("May I know your name, please?");
  });

  it("STOP opts the customer out, cancels pending jobs and suppresses automation", async () => {
    const h = createHarness();
    await h.say("Hi");
    await h.say("stop");
    expect(h.scheduler.cancelled).toHaveLength(1);
    expect(h.execution().status).toBe("cancelled");
    const sent = h.sender.sent.length;
    await h.say("Hi");
    expect(h.sender.sent.length).toBe(sent);
  });

  it("HUMAN hands the conversation to the team", async () => {
    const h = createHarness();
    await h.say("Hi");
    await h.say("human");
    expect([...h.store.conversations.values()][0].status).toBe("handoff");
    expect(h.store.notifications.some((n) => n.kind === "handoff")).toBe(true);
    const sent = h.sender.sent.length;
    await h.say("Are you there?");
    expect(h.sender.sent.length).toBe(sent);
  });

  it("throttles a flooding customer but still records every message", async () => {
    const h = createHarness({ settings: { rateLimits: { inboundPerMinute: 3 } } as never });
    for (let i = 0; i < 6; i++) await h.say(`msg ${i}`);
    const inbound = h.store.messages.filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(6);
    expect(inbound.filter((m) => m.processingStatus === "rate_limited").length).toBe(3);
  });

  it("ignores events for other WhatsApp Business Accounts or phone numbers", async () => {
    const h = createHarness();
    await h.deliver(metaInboundPayload([{ text: "Hi" }], { wabaId: "OTHER" }));
    await h.deliver(metaInboundPayload([{ text: "Hi" }], { phoneNumberId: "PN-OTHER" }));
    expect(h.store.messages).toHaveLength(0);
    expect(h.sender.sent).toHaveLength(0);
  });

  it("skips the brochure gracefully when none is configured", async () => {
    const h = createHarness({ withBrochure: false });
    await h.say("Hi");
    expect(h.sender.sent).toHaveLength(1);
    expect(h.scheduler.scheduled).toHaveLength(1);
  });

  it("hard usage cap skips non-essential delays instead of dropping the customer", async () => {
    const h = createHarness({ settings: { usage: { hardCapEnabled: true, qstashDailyBudget: 0 } } as never });
    await h.say("Hi");
    expect(h.scheduler.scheduled).toHaveLength(0);
    expect(h.sender.texts().at(-1)).toBe("May I know your name, please?");
  });
});
