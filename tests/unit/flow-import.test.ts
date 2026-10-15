import { describe, expect, it } from "vitest";
import { AI_PROMPT_EXAMPLE, buildAiPrompt } from "@/lib/flows/ai-prompt";
import { exportFlowJson, fixRequestText, importFlowJson } from "@/lib/flows/import";
import { NODE_TYPES } from "@/lib/engine/schema";
import { buildDefaultFlowDefinition } from "../fixtures/star-flow";

const json = (v: unknown) => JSON.stringify(v);

describe("workflow JSON import", () => {
  it("imports the prompt's own example without problems", () => {
    const r = importFlowJson(json(AI_PROMPT_EXAMPLE));
    expect(r.errors).toEqual([]);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.name).toBe("Website enquiry");
    expect(r.definition!.nodes).toHaveLength(AI_PROMPT_EXAMPLE.steps.length);
    expect(r.definition!.edges.find((e) => e.source === "check_name" && e.sourceHandle === "invalid")?.target).toBe("to_team");
    // Laid out top to bottom.
    const y = (id: string) => r.definition!.nodes.find((n) => n.id === id)!.position.y;
    expect(y("start")).toBeLessThan(y("welcome"));
  });

  it("reads JSON out of a whole ChatGPT reply", () => {
    const reply = `Sure! Here is your workflow:\n\n\`\`\`json\n${JSON.stringify(AI_PROMPT_EXAMPLE, null, 2)}\n\`\`\`\n\nLet me know if you want changes.`;
    expect(importFlowJson(reply).definition).not.toBeNull();
  });

  it("fills in defaults for config fields that were left out", () => {
    const r = importFlowJson(
      json({ steps: [{ id: "s", type: "trigger", next: "w" }, { id: "w", type: "wait", config: { amount: 3 } }] }),
    );
    const wait = r.definition!.nodes.find((n) => n.id === "w")!;
    expect(wait.data.config).toMatchObject({ amount: 3, unit: "seconds" });
    expect(wait.data.label).toBe("Wait");
  });

  it("explains problems that stop the import", () => {
    const bad = importFlowJson(
      json({
        steps: [
          { id: "start", type: "trigger", next: "missing" },
          { id: "x", type: "send_sms" },
          { id: "c", type: "condition", config: { operator: "is_set", left: "{{contact.name}}" }, next: "start" },
          { id: "e", type: "end", next: "start" },
        ],
      }),
    );
    expect(bad.definition).toBeNull();
    expect(bad.errors.join("\n")).toMatch(/no step with that id/);
    expect(bad.errors.join("\n")).toMatch(/unknown type “send_sms”/);
    expect(bad.errors.join("\n")).toMatch(/several outputs.*"true".*"false"/);
    expect(bad.errors.join("\n")).toMatch(/ends the workflow/);
    expect(importFlowJson("not json at all").errors[0]).toMatch(/No JSON object/);
    expect(importFlowJson(json({ steps: [{ id: "a", type: "end" }] })).errors[0]).toMatch(/trigger/);
  });

  it("still imports workflows with config problems, listing them for the editor", () => {
    const r = importFlowJson(
      json({
        steps: [
          { id: "s", type: "trigger", next: "q" },
          { id: "q", type: "interactive", config: { body: "Pick one", options: [{ id: "a", title: "This title is far too long for WhatsApp" }], variable: "x" } },
        ],
      }),
    );
    expect(r.definition).not.toBeNull();
    expect(r.issues.some((i) => i.level === "error" && i.message.includes("24 characters"))).toBe(true);
    expect(fixRequestText(r)).toContain("24 characters");
  });

  it("round-trips through export (what you send ChatGPT to change a workflow)", () => {
    const def = buildDefaultFlowDefinition(null);
    const exported = exportFlowJson(def, { name: "Enquiry", description: "Main flow" });
    const back = importFlowJson(exported);
    expect(back.errors).toEqual([]);
    expect(back.name).toBe("Enquiry");
    const key = (d: typeof def) => d.edges.map((e) => `${e.source}:${e.sourceHandle ?? "out"}>${e.target}`).sort();
    expect(key(back.definition!)).toEqual(key(def));
    expect(back.definition!.nodes.map((n) => n.id).sort()).toEqual(def.nodes.map((n) => n.id).sort());
  });

  it("accepts the full editor format too", () => {
    const def = buildDefaultFlowDefinition(null);
    expect(importFlowJson(json(def)).definition?.nodes).toHaveLength(def.nodes.length);
  });
});

describe("ChatGPT prompt", () => {
  it("documents every step type and lists media and CRM ids", () => {
    const prompt = buildAiPrompt({
      media: [{ id: "11111111-1111-4111-8111-111111111111", name: "Brochure.pdf", kind: "document" }],
      crm: [
        { id: "22222222-2222-4222-8222-222222222222", name: "HubSpot", enabled: true },
        { id: "33333333-3333-4333-8333-333333333333", name: "Old CRM", enabled: false },
      ],
    });
    for (const type of NODE_TYPES) expect(prompt).toContain(`### ${type} — `);
    expect(prompt).toContain('"Brochure.pdf" (document): 11111111-1111-4111-8111-111111111111');
    expect(prompt).toContain('"HubSpot"');
    expect(prompt).not.toContain("Old CRM");
    expect(prompt).toContain('"next": { "valid": "<step id>", "invalid": "<step id>" }');
  });
});
