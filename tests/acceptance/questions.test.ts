import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";
import { metaInboundPayload } from "../helpers/meta";
import type { FlowDefinition, FlowEdge, FlowNode, NodeType } from "@/lib/engine/schema";
import { DONE_ID } from "@/lib/engine/interactive";
import { parseDate } from "@/lib/engine/input-types";

const node = (id: string, type: NodeType, config: Record<string, unknown> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: "", config } });
const edge = (source: string, target: string, sourceHandle = "out"): FlowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle });
const flow = (nodes: FlowNode[], edges: FlowEdge[]): FlowDefinition => ({ nodes: [node("t", "trigger"), ...nodes], edges: [edge("t", nodes[0].id), ...edges] });

const OPTIONS = [
  { id: "web", title: "Website", description: "" },
  { id: "ads", title: "Ads", description: "" },
  { id: "seo", title: "SEO", description: "" },
];

function multiFlow(extra: Record<string, unknown> = {}) {
  return flow(
    [
      node("q", "interactive", { body: "Which services?", options: OPTIONS, variable: "picks", selection: "multiple", ...extra }),
      node("c", "condition", { left: "{{vars.picks.id}}", operator: "option_selected", right: "seo" }),
      node("yes", "send_message", { text: "Got {{vars.picks}} (with SEO)" }),
      node("no", "send_message", { text: "Got {{vars.picks}}" }),
    ],
    [edge("q", "c"), edge("c", "yes", "true"), edge("c", "no", "false")],
  );
}

describe("Multiple choice", () => {
  it("re-sends the list with ticks after each tap and finishes on Done", async () => {
    const h = createHarness({ definition: multiFlow() });
    await h.say("Hi");
    const first = h.sender.sent.at(-1)!.message;
    expect(first.kind).toBe("list");
    if (first.kind === "list") expect(first.rows.at(-1)).toMatchObject({ id: DONE_ID, title: "✅ Done" });

    await h.select("web", "Website");
    const second = h.sender.sent.at(-1)!.message;
    if (second.kind !== "list") throw new Error("expected a list");
    expect(second.rows[0].title).toBe("✓ Website");
    expect(second.body).toContain("Selected: Website");

    await h.select("seo", "SEO");
    await h.select("web", "✓ Website"); // tapping again removes it
    await h.select(DONE_ID, "✅ Done");
    expect(h.sender.texts().at(-1)).toBe("Got SEO (with SEO)");
    expect(h.execution().status).toBe("completed");
  });

  it("accepts typed numbers or titles in one go", async () => {
    const h = createHarness({ definition: multiFlow() });
    await h.say("Hi");
    await h.say("1 and 2");
    expect(h.sender.texts().at(-1)).toBe("Got Website, Ads");

    const h2 = createHarness({ definition: multiFlow() });
    await h2.say("Hi");
    await h2.say("website, seo");
    expect(h2.sender.texts().at(-1)).toBe("Got Website, SEO (with SEO)");
  });

  it("enforces the minimum and maximum number of choices", async () => {
    const h = createHarness({ definition: multiFlow({ minSelect: 2, maxSelect: 2 }) });
    await h.say("Hi");
    await h.select("web", "Website");
    await h.select(DONE_ID, "✅ Done");
    const again = h.sender.sent.at(-1)!.message;
    expect(again.kind === "list" && again.body).toContain("Please choose at least 2.");
    // Reaching the maximum finishes on its own.
    await h.select("ads", "Ads");
    expect(h.sender.texts().at(-1)).toBe("Got Website, Ads");
  });

  it("asks again (without moving on) when the reply isn't an option", async () => {
    const h = createHarness({ definition: multiFlow() });
    await h.say("Hi");
    await h.say("not sure");
    const again = h.sender.sent.at(-1)!.message;
    expect(again.kind === "list" && again.body).toContain("You can also type their numbers");
    expect(h.execution().status).toBe("waiting_input");
  });
});

describe("Answer types", () => {
  const typed = (inputType: string, extra: Record<string, unknown> = {}, withFailed = true) =>
    flow(
      [
        node("q", "ask_question", { question: "Your answer?", variable: "a", inputType, ...extra }),
        node("ok", "send_message", { text: "Thanks: {{vars.a}}" }),
        ...(withFailed ? [node("fail", "send_message", { text: "Let me get a person." })] : []),
      ],
      [edge("q", "ok"), ...(withFailed ? [edge("q", "fail", "invalid")] : [])],
    );

  it("re-asks for a valid email and stores it in lower case", async () => {
    const h = createHarness({ definition: typed("email") });
    await h.say("Hi");
    await h.say("asha at gmail");
    expect(h.sender.texts().at(-1)).toBe("That doesn't look like an email address. Please type it again.");
    await h.say("Asha@Example.com");
    expect(h.sender.texts().at(-1)).toBe("Thanks: asha@example.com");
  });

  it("takes the Failed branch after the last try", async () => {
    const h = createHarness({ definition: typed("number", { maxAttempts: 2, errorMessage: "Numbers only please" }) });
    await h.say("Hi");
    await h.say("lots");
    expect(h.sender.texts().at(-1)).toBe("Numbers only please");
    await h.say("many");
    expect(h.sender.texts().at(-1)).toBe("Let me get a person.");
  });

  it("carries on with what they wrote when Failed isn't connected", async () => {
    const h = createHarness({ definition: typed("phone", { maxAttempts: 1 }, false) });
    await h.say("Hi");
    await h.say("call me");
    expect(h.sender.texts().at(-1)).toBe("Thanks: call me");
  });

  it("checks number ranges", async () => {
    const h = createHarness({ definition: typed("number", { min: 1, max: 10 }) });
    await h.say("Hi");
    await h.say("25");
    expect(h.sender.texts().at(-1)).toBe("Please reply with a number.");
    await h.say("7 people");
    expect(h.sender.texts().at(-1)).toBe("Thanks: 7");
  });

  it("understands dates like “tomorrow” in the business timezone", async () => {
    const h = createHarness({ definition: typed("date") });
    await h.say("Hi");
    await h.say("tomorrow");
    // The harness clock is 14 Oct 2026, 10:00 UTC (15:30 in India).
    expect(h.sender.texts().at(-1)).toBe("Thanks: Thu, 15 Oct 2026");
    expect(h.execution().context.vars.a).toMatchObject({ kind: "date", iso: "2026-10-15" });
  });

  it("accepts a photo for a media question and a pin for a location question", async () => {
    const h = createHarness({ definition: typed("media") });
    await h.say("Hi");
    await h.say("just text");
    expect(h.sender.texts().at(-1)).toBe("Please send a photo or a file.");
    await h.deliver(metaInboundPayload([{ type: "image", content: { id: "MEDIA1", mime_type: "image/jpeg", caption: "my shop" }, timestamp: h.clock.now() }]));
    expect(h.sender.texts().at(-1)).toBe("Thanks: [photo] my shop");
    expect(h.execution().context.vars.a).toMatchObject({ kind: "media", mediaId: "MEDIA1", mimeType: "image/jpeg" });

    const l = createHarness({ definition: typed("location") });
    await l.say("Hi");
    await l.deliver(
      metaInboundPayload([{ type: "location", content: { latitude: 12.97, longitude: 77.59, name: "Acme Studio", address: "MG Road" }, timestamp: l.clock.now() }]),
    );
    expect(l.sender.texts().at(-1)).toBe("Thanks: Acme Studio, MG Road");
  });
});

describe("No reply follow-up", () => {
  const withTimeout = flow(
    [
      node("q", "ask_question", { question: "What's your name?", variable: "name", timeoutMinutes: 30 }),
      node("thanks", "send_message", { text: "Thanks {{vars.name}}" }),
      node("nudge", "send_message", { text: "Still there? 🙂" }),
    ],
    [edge("q", "thanks"), edge("q", "nudge", "no_reply")],
  );

  it("runs the No reply branch when the customer doesn't answer in time", async () => {
    const h = createHarness({ definition: withTimeout });
    await h.say("Hi");
    expect(h.scheduler.scheduled).toHaveLength(1);
    expect(h.scheduler.scheduled[0].delaySeconds).toBe(1800);
    h.clock.advance(1800);
    await h.runDueJobs();
    expect(h.sender.texts().at(-1)).toBe("Still there? 🙂");
  });

  it("cancels the timer when they answer", async () => {
    const h = createHarness({ definition: withTimeout });
    await h.say("Hi");
    h.clock.advance(60);
    await h.say("Asha");
    expect(h.sender.texts().at(-1)).toBe("Thanks Asha");
    expect(h.scheduler.cancelled).toHaveLength(1);
    h.clock.advance(1800);
    await h.runDueJobs();
    expect(h.sender.texts().at(-1)).toBe("Thanks Asha");
  });
});

describe("parseDate", () => {
  const now = new Date("2026-10-14T20:00:00Z"); // 15 Oct, 01:30 in India
  const d = (t: string) => parseDate(t, "Asia/Kolkata", now)?.toISOString().slice(0, 10) ?? null;
  it("uses the business timezone and understands common formats", () => {
    expect(d("today")).toBe("2026-10-15");
    expect(d("25/10")).toBe("2026-10-25");
    expect(d("25-10-2026")).toBe("2026-10-25");
    expect(d("2026-11-02")).toBe("2026-11-02");
    expect(d("2 Nov")).toBe("2026-11-02");
    expect(d("Nov 2nd")).toBe("2026-11-02");
    expect(d("1/1")).toBe("2027-01-01"); // already past this year
    expect(d("friday")).toBe("2026-10-16");
    expect(d("31/02")).toBeNull();
    expect(d("someday")).toBeNull();
  });
});
