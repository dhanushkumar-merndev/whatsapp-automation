import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";
import { metaInboundPayload } from "../helpers/meta";
import { ingestWebhook } from "@/lib/core/webhook-ingest";
import { processConversation } from "@/lib/core/process-conversation";
import type { FlowDefinition } from "@/lib/engine/schema";

const NAME_QUESTION = "May I know your name, please?";

/** A flow that answers and ends without asking anything. */
const infoOnly: FlowDefinition = {
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { label: "", config: {} } },
    { id: "m1", type: "send_message", position: { x: 0, y: 100 }, data: { label: "", config: { text: "Hello!" } } },
    { id: "w", type: "wait", position: { x: 0, y: 200 }, data: { label: "", config: { amount: 5, unit: "seconds" } } },
    { id: "m2", type: "send_message", position: { x: 0, y: 300 }, data: { label: "", config: { text: "Here are our prices." } } },
  ],
  edges: [
    { id: "e1", source: "t", target: "m1", sourceHandle: "out" },
    { id: "e2", source: "m1", target: "w", sourceHandle: "out" },
    { id: "e3", source: "w", target: "m2", sourceHandle: "out" },
  ],
};

describe("Fast replies", () => {
  it("short waits run inside the reply: no QStash job, and the customer sees typing meanwhile", async () => {
    const h = createHarness({ inlineWaits: true });
    await h.say("Hi");
    expect(h.scheduler.scheduled).toHaveLength(0);
    expect(h.sender.texts().at(-1)).toBe(NAME_QUESTION);
    expect(h.execution().status).toBe("waiting_input");
    // "typing…" was shown again during the 5-second pause.
    expect(h.sender.reads).toHaveLength(1);
  });

  it("long waits still go through QStash", async () => {
    const def = structuredClone(infoOnly);
    def.nodes[2].data.config = { amount: 2, unit: "minutes" };
    const h = createHarness({ inlineWaits: true, definition: def });
    await h.say("Hi");
    expect(h.scheduler.scheduled).toHaveLength(1);
    expect(h.execution().status).toBe("waiting_delay");
  });

  it("a message written during the wait is kept but not taken as the answer to the next question", async () => {
    const h = createHarness({ inlineWaits: true });
    const start = h.clock.now();
    await h.say("Hi");
    // Written 2 s into the 5 s pause, delivered after the name question went out.
    await h.deliver(metaInboundPayload([{ text: "I need a website", timestamp: new Date(start.getTime() + 2000) }]));
    const early = h.store.messages.find((m) => m.body === "I need a website")!;
    expect(early.processingNote).toBe("received_before_question");
    expect(h.execution().status).toBe("waiting_input");
    h.clock.advance(3);
    await h.say("Asha Kumar");
    expect(h.lead()?.name).toBe("Asha Kumar");
  });

  it("a message sent while the previous run was still replying does not restart the flow", async () => {
    const h = createHarness({ inlineWaits: true, definition: infoOnly });
    const start = h.clock.now();
    await h.say("Hi");
    expect(h.sender.texts()).toEqual(["Hello!", "Here are our prices."]);
    await h.deliver(metaInboundPayload([{ text: "ok", timestamp: new Date(start.getTime() + 2000) }]));
    expect(h.sender.texts()).toHaveLength(2);
    expect(h.store.messages.find((m) => m.body === "ok")!.processingNote).toBe("received_during_previous_run");
    // A later message starts it again as usual.
    h.clock.advance(60);
    await h.say("Hi again");
    expect(h.sender.texts()).toHaveLength(4);
  });

  it("the in-request wait budget falls back to QStash once used up", async () => {
    const def = structuredClone(infoOnly);
    def.nodes[2].data.config = { amount: 20, unit: "seconds" };
    const h = createHarness({ inlineWaits: true, definition: def });
    const r = await ingestWebhook({ store: h.store, now: h.clock.now }, metaInboundPayload([{ text: "Hi", timestamp: h.clock.now() }]));
    h.deps.inlineWait!.budgetMs = 10_000;
    for (const c of r.conversations) await processConversation(h.deps, c);
    expect(h.scheduler.scheduled).toHaveLength(1);
  });
});

describe("Typing indicator on arrival", () => {
  it("is requested for new customer messages the bot will answer", async () => {
    const h = createHarness();
    const r = await ingestWebhook({ store: h.store }, metaInboundPayload([{ text: "Hi", id: "wamid.A" }]));
    expect(r.typing).toEqual([{ phoneNumberId: "PN1", waMessageId: "wamid.A" }]);
    // A Meta retry of the same message is not typed again.
    const again = await ingestWebhook({ store: h.store }, metaInboundPayload([{ text: "Hi", id: "wamid.A" }]));
    expect(again.typing).toEqual([]);
  });

  it("is not requested while a person handles the chat, for opted-out customers, or for reactions", async () => {
    const h = createHarness();
    await h.say("Hi");
    await h.say("human");
    const handoff = await ingestWebhook({ store: h.store }, metaInboundPayload([{ text: "hello?", timestamp: h.clock.now() }]));
    expect(handoff.typing).toEqual([]);

    const other = "919800000009";
    await h.say("stop", { from: other });
    const optedOut = await ingestWebhook({ store: h.store }, metaInboundPayload([{ text: "hi", from: other }]));
    expect(optedOut.typing).toEqual([]);

    const reaction = await ingestWebhook({ store: h.store }, metaInboundPayload([{ type: "reaction", from: "919800000010" }]));
    expect(reaction.typing).toEqual([]);
  });

  it("marks conversations from configured test numbers as tests", async () => {
    const h = createHarness({ settings: { testPhoneNumbers: ["919876543210"] } as never });
    await h.say("Hi");
    expect([...h.store.conversations.values()][0].isTest).toBe(true);
  });
});
