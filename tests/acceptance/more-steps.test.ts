import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";
import type { FlowDefinition, FlowEdge, FlowNode, NodeType } from "@/lib/engine/schema";
import type { HttpPort } from "@/lib/engine/types";
import { buildMessagePayload } from "@/lib/whatsapp/payload";
import { isWithinBusinessHours } from "@/lib/engine/business-hours";
import { DEFAULT_SETTINGS } from "@/lib/settings/schema";

const node = (id: string, type: NodeType, config: Record<string, unknown> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: "", config } });
const edge = (source: string, target: string, sourceHandle = "out"): FlowEdge => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle });
/** trigger → steps in a line (each "out" to the next). */
const line = (...steps: FlowNode[]): FlowDefinition => ({
  nodes: [node("t", "trigger"), ...steps],
  edges: [node("t", "trigger"), ...steps].slice(0, -1).map((n, i) => edge(n.id, steps[i].id)),
});

describe("Messages", () => {
  it("adds a link button to a message", async () => {
    const h = createHarness({ definition: line(node("m", "send_message", { text: "Our prices", buttonText: "See prices", buttonUrl: "https://example.com/p?for={{contact.name|you}}" })) });
    await h.say("Hi");
    const m = h.sender.sent[0].message;
    expect(m).toEqual({ kind: "cta_url", body: "Our prices", buttonText: "See prices", url: "https://example.com/p?for=you" });
    expect(buildMessagePayload("91", m)).toMatchObject({
      type: "interactive",
      interactive: { type: "cta_url", action: { name: "cta_url", parameters: { display_text: "See prices", url: "https://example.com/p?for=you" } } },
    });
  });

  it("sends a location pin", async () => {
    const h = createHarness({ definition: line(node("l", "send_location", { latitude: 12.97, longitude: 77.59, name: "Acme Studio", address: "MG Road" })) });
    await h.say("Hi");
    const m = h.sender.sent[0].message;
    expect(buildMessagePayload("91", m)).toMatchObject({ type: "location", location: { latitude: 12.97, longitude: 77.59, name: "Acme Studio", address: "MG Road" } });
  });
});

describe("Team, variables and tags", () => {
  it("alerts the team and carries on", async () => {
    const h = createHarness({
      definition: line(node("n", "notify_team", { title: "VIP: {{contact.name|someone}}", message: "Call {{contact.phone}}" }), node("m", "send_message", { text: "Done" })),
    });
    await h.say("Hi");
    expect(h.store.notifications.find((n) => n.kind === "team_alert")).toMatchObject({ title: "VIP: someone", body: "Call +919876543210" });
    expect(h.sender.texts()).toEqual(["Done"]);
  });

  it("stores a value and tags the customer", async () => {
    const h = createHarness({
      definition: line(
        node("v", "set_variable", { variable: "source", value: "ad-{{vars.first_message}}" }),
        node("a", "add_tag", { tags: ["hot lead", "web"] }),
        node("r", "add_tag", { tags: ["web"], action: "remove" }),
        node("m", "send_message", { text: "{{vars.source}} / {{contact.tags}}" }),
      ),
    });
    await h.say("Hi");
    expect(h.sender.texts()).toEqual(["ad-Hi / hot lead"]);
    expect([...h.store.contacts.values()][0].tags).toEqual(["hot lead"]);
  });
});

describe("Business hours", () => {
  const def = (): FlowDefinition => ({
    nodes: [
      node("t", "trigger"),
      node("c", "condition", { operator: "within_business_hours" }),
      node("open", "send_message", { text: "We're open" }),
      node("closed", "send_message", { text: "We're closed" }),
    ],
    edges: [edge("t", "c"), edge("c", "open", "true"), edge("c", "closed", "false")],
  });

  it("branches on the opening hours in Settings (business timezone)", async () => {
    // Wednesday 10:00 UTC = 15:30 in India: open by default (10:00–19:00).
    const h = createHarness({ definition: def() });
    await h.say("Hi");
    expect(h.sender.texts()).toEqual(["We're open"]);

    const closed = createHarness({
      definition: def(),
      settings: { business: { timezone: "Asia/Kolkata", hours: { ...DEFAULT_SETTINGS.business.hours, wed: { open: true, from: "09:00", to: "15:00" } } } },
    });
    await closed.say("Hi");
    expect(closed.sender.texts()).toEqual(["We're closed"]);
  });

  it("treats closed days as closed", () => {
    const b = { ...DEFAULT_SETTINGS.business };
    expect(isWithinBusinessHours(b, new Date("2026-10-18T06:00:00Z"))).toBe(false); // Sunday
    expect(isWithinBusinessHours(b, new Date("2026-10-19T06:00:00Z"))).toBe(true); // Monday 11:30 IST
    expect(isWithinBusinessHours(b, new Date("2026-10-19T14:00:00Z"))).toBe(false); // Monday 19:30 IST
  });
});

describe("API request", () => {
  const apiFlow = (url = "https://api.example.com/score?phone={{contact.phone}}") => ({
    nodes: [
      node("t", "trigger"),
      node("api", "api_request", { method: "POST", url, body: '{ "msg": "{{vars.first_message}}" }', variable: "crm" }),
      node("ok", "send_message", { text: "Score {{vars.crm.score}} ({{vars.crm.status}})" }),
      node("bad", "send_message", { text: "Lookup failed {{vars.crm.status}}" }),
    ],
    edges: [edge("t", "api"), edge("api", "ok", "success"), edge("api", "bad", "error")],
  });
  const fake = (respond: (input: Parameters<HttpPort["request"]>[0]) => { status: number; body: string } | Error) => {
    const calls: Parameters<HttpPort["request"]>[0][] = [];
    const http: HttpPort = {
      async request(input) {
        calls.push(input);
        const r = respond(input);
        if (r instanceof Error) throw r;
        return r;
      },
    };
    return { http, calls };
  };

  it("saves the JSON reply and takes the OK branch", async () => {
    const h = createHarness({ definition: apiFlow() });
    const { http, calls } = fake(() => ({ status: 200, body: '{"score": 87}' }));
    h.deps.http = http;
    await h.say('Hi "there"');
    expect(h.sender.texts()).toEqual(["Score 87 (200)"]);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.example.com/score?phone=%2B919876543210",
      body: '{ "msg": "Hi \\"there\\"" }',
      headers: { "Content-Type": "application/json" },
    });
  });

  it("takes the Error branch on a failed status or network error", async () => {
    const h = createHarness({ definition: apiFlow() });
    h.deps.http = fake(() => ({ status: 503, body: "busy" })).http;
    await h.say("Hi");
    expect(h.sender.texts()).toEqual(["Lookup failed 503"]);

    const h2 = createHarness({ definition: apiFlow() });
    h2.deps.http = fake(() => new Error("Destination resolves to a private or reserved address")).http;
    await h2.say("Hi");
    expect(h2.sender.texts()).toEqual(["Lookup failed 0"]);
  });

  it("is skipped (OK branch, empty reply) where there is no network, e.g. the simulator", async () => {
    const h = createHarness({ definition: apiFlow() });
    await h.say("Hi");
    expect(h.sender.texts()).toEqual(["Score  (0)"]);
  });
});

describe("WhatsApp Form", () => {
  const formFlow = line(
    node("f", "whatsapp_form", { flowId: "123456789", screen: "QUESTION_ONE", cta: "Fill form", body: "A few details please", variable: "form" }),
    node("m", "send_message", { text: "Thanks! We'll write to {{vars.form.email}}." }),
  );

  it("sends the form, nudges on other replies, and stores the submitted answers", async () => {
    const h = createHarness({ definition: formFlow });
    await h.say("Hi");
    const m = h.sender.sent[0].message;
    expect(m).toMatchObject({ kind: "flow", flowId: "123456789", screen: "QUESTION_ONE", cta: "Fill form" });
    expect(buildMessagePayload("91", m)).toMatchObject({
      type: "interactive",
      interactive: { type: "flow", action: { name: "flow", parameters: { flow_id: "123456789", flow_cta: "Fill form", flow_action: "navigate", flow_action_payload: { screen: "QUESTION_ONE" } } } },
    });

    await h.say("what form?");
    expect(h.sender.texts().at(-1)).toBe("Please tap “Fill form” above to fill in the form 🙂");

    await h.deliver({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PN1" },
                contacts: [{ wa_id: "919876543210", profile: { name: "Asha" } }],
                messages: [
                  {
                    from: "919876543210",
                    id: "wamid.form1",
                    timestamp: String(Math.floor(h.clock.now().getTime() / 1000)),
                    type: "interactive",
                    interactive: {
                      type: "nfm_reply",
                      nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify({ flow_token: "x", email: "asha@example.com", services: ["web", "ads"] }) },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(h.sender.texts().at(-1)).toBe("Thanks! We'll write to asha@example.com.");
    expect(h.execution().context.vars.form).toMatchObject({ email: "asha@example.com", services: ["web", "ads"] });
  });
});
