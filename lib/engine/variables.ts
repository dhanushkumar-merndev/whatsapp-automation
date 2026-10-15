import type { FlowDefinition, InteractiveOption } from "./schema";

/**
 * Variables a flow can reference in templates ({{vars.name}}, {{contact.name}}).
 * Shared by the graph validator and the builder's variable pickers, so it must
 * stay browser-safe.
 */

export interface FlowVariable {
  /** Template path without braces, e.g. "vars.name" or "contact.name". */
  path: string;
  label: string;
  group: "Answers" | "Customer" | "Messages";
  /** Bare variable name for answers stored by a question (what Validation checks). */
  name?: string;
  /** The question node that stores the answer. */
  nodeId?: string;
  /** Present when the answer comes from an interactive selection. */
  options?: InteractiveOption[];
}

const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** Variables the engine sets on every execution. */
export const BUILTIN_VAR_NAMES = ["first_message", "last_message"] as const;

export const BUILTIN_VARIABLES: FlowVariable[] = [
  { path: "contact.name", label: "Customer name", group: "Customer" },
  { path: "contact.profile_name", label: "WhatsApp profile name", group: "Customer" },
  { path: "contact.business_name", label: "Business name (saved)", group: "Customer" },
  { path: "contact.phone", label: "Phone number", group: "Customer" },
  { path: "contact.email", label: "Email (saved)", group: "Customer" },
  { path: "vars.first_message", label: "First message", group: "Messages" },
  { path: "vars.last_message", label: "Latest message", group: "Messages" },
];

/** Answers stored by Ask question / Interactive nodes, in flow order. Tolerates half-edited configs. */
export function listAnswerVariables(def: Pick<FlowDefinition, "nodes">): FlowVariable[] {
  const out: FlowVariable[] = [];
  const seen = new Set<string>();
  for (const n of def.nodes) {
    if (n.type !== "ask_question" && n.type !== "interactive" && n.type !== "booking") continue;
    const c = n.data.config as Record<string, unknown>;
    const name = typeof c.variable === "string" ? c.variable.trim() : n.type === "booking" ? "booking" : "";
    if (!VARIABLE_NAME.test(name) || seen.has(name)) continue;
    seen.add(name);
    const prompt = n.type === "ask_question" ? c.question : n.type === "booking" ? "Booked day and time" : c.body;
    const options = n.type === "interactive" && Array.isArray(c.options) ? (c.options as InteractiveOption[]) : undefined;
    out.push({
      path: `vars.${name}`,
      label: n.data.label?.trim() || (typeof prompt === "string" ? prompt.trim() : "") || name,
      group: "Answers",
      name,
      nodeId: n.id,
      options,
    });
  }
  return out;
}

export function listFlowVariables(def: Pick<FlowDefinition, "nodes">): FlowVariable[] {
  return [...listAnswerVariables(def), ...BUILTIN_VARIABLES];
}

/** Names usable as {{vars.<name>}}: stored answers plus the engine built-ins. */
export function definedVariableNames(def: Pick<FlowDefinition, "nodes">): Set<string> {
  return new Set<string>([...listAnswerVariables(def).map((v) => v.name!), ...BUILTIN_VAR_NAMES]);
}

