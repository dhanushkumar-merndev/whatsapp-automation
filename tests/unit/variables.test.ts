import { describe, expect, it } from "vitest";
import { definedVariableNames, listAnswerVariables, listFlowVariables } from "@/lib/engine/variables";
import { buildDefaultFlowDefinition } from "@/lib/flows/default-flow";
import type { FlowNode } from "@/lib/engine/schema";

const node = (id: string, type: FlowNode["type"], label: string, config: Record<string, unknown>): FlowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label, config },
});

describe("flow variables", () => {
  it("lists answers from questions with their options", () => {
    const vars = listAnswerVariables({
      nodes: [
        node("q", "ask_question", "Ask name", { question: "Your name?", variable: "name" }),
        node("i", "interactive", "", { body: "Pick a service", variable: "service", options: [{ id: "a", title: "A", description: "" }] }),
        node("m", "send_message", "Hi", { text: "Hi" }),
      ],
    });
    expect(vars.map((v) => v.path)).toEqual(["vars.name", "vars.service"]);
    expect(vars[0]).toMatchObject({ label: "Ask name", nodeId: "q", name: "name" });
    expect(vars[1].label).toBe("Pick a service");
    expect(vars[1].options).toHaveLength(1);
  });

  it("skips invalid or duplicate variable names", () => {
    const vars = listAnswerVariables({
      nodes: [
        node("a", "ask_question", "", { question: "?", variable: "Bad Name" }),
        node("b", "ask_question", "", { question: "?", variable: "dup" }),
        node("c", "ask_question", "", { question: "?", variable: "dup" }),
      ],
    });
    expect(vars.map((v) => v.name)).toEqual(["dup"]);
  });

  it("includes built-ins and the engine's message variables", () => {
    const all = listFlowVariables({ nodes: [] });
    expect(all.some((v) => v.path === "contact.name")).toBe(true);
    expect(definedVariableNames({ nodes: [] })).toEqual(new Set(["first_message", "last_message"]));
  });

  it("finds the default enquiry flow's answers", () => {
    const names = definedVariableNames(buildDefaultFlowDefinition());
    for (const n of ["name", "service", "business_name", "requirements"]) expect(names.has(n)).toBe(true);
  });
});
