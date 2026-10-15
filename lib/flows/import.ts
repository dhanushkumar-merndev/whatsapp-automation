import dagre from "@dagrejs/dagre";
import { z } from "zod";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import { flowDefinitionSchema, NODE_TYPES, type FlowDefinition, type FlowEdge, type FlowNode, type NodeType } from "@/lib/engine/schema";
import { validateFlow, type GraphIssue } from "@/lib/engine/validate-graph";

/**
 * Workflow JSON exchanged with ChatGPT. The "simple" format lists steps with a
 * `next` link instead of canvas positions and edge ids, which language models
 * get right far more often:
 *
 *   { "name": "…", "description": "…",
 *     "steps": [ { "id": "start", "type": "trigger", "config": {…}, "next": "welcome" },
 *                { "id": "check", "type": "condition", "config": {…}, "next": { "true": "a", "false": "b" } } ] }
 *
 * The full editor format ({ nodes: [{ id, type, position, data }], edges }) is accepted too.
 * Browser-safe: used live in the import dialog and again on the server.
 */

export interface ImportResult {
  name: string | null;
  description: string | null;
  /** Null when the JSON could not be turned into a workflow (see `errors`). */
  definition: FlowDefinition | null;
  /** Problems that stop the import: invalid JSON, unknown step types, broken links. */
  errors: string[];
  /** Workflow problems the editor also shows. The workflow can still be saved as a draft. */
  issues: GraphIssue[];
}

const STEP_ID = /^[A-Za-z0-9_-]{1,64}$/;

const simpleFlowSchema = z.object({
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  steps: z
    .array(
      z.object({
        id: z.string().trim(),
        type: z.string().trim(),
        label: z.string().trim().max(80).optional(),
        config: z.record(z.string(), z.unknown()).nullish(),
        next: z.union([z.string(), z.record(z.string(), z.string().nullable()), z.null()]).optional(),
      }),
    )
    .min(1, "The workflow has no steps")
    .max(200, "A workflow can have at most 200 steps"),
});

/** Pulls the JSON object out of a ChatGPT reply (code fences and chatter around it are ignored). */
export function extractJson(text: string): { value: unknown } | { error: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  let body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: "No JSON object found. Paste the full JSON that ChatGPT gave you." };
  body = body.slice(start, end + 1);
  try {
    return { value: JSON.parse(body) };
  } catch (e) {
    return { error: `The JSON is not valid: ${e instanceof Error ? e.message : String(e)}. Ask ChatGPT to send the complete JSON again.` };
  }
}

function zodMessages(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`);
}

/** Lays steps out top to bottom, like "Tidy up layout" in the editor. */
export function layoutNodes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: 280, height: 110 });
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return p ? { ...n, position: { x: Math.round(p.x - 140), y: Math.round(p.y - 55) } } : n;
  });
}

function fromSimple(input: z.infer<typeof simpleFlowSchema>): { definition: FlowDefinition | null; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  const nodes: FlowNode[] = [];
  for (const [i, step] of input.steps.entries()) {
    const where = `Step ${i + 1}${step.id ? ` (“${step.id}”)` : ""}`;
    if (!STEP_ID.test(step.id)) {
      errors.push(`${where}: "id" must be 1–64 letters, numbers, _ or -.`);
      continue;
    }
    if (ids.has(step.id)) {
      errors.push(`${where}: the id “${step.id}” is used more than once.`);
      continue;
    }
    ids.add(step.id);
    if (!(NODE_TYPES as readonly string[]).includes(step.type)) {
      errors.push(`${where}: unknown type “${step.type}”. Use one of: ${NODE_TYPES.join(", ")}.`);
      continue;
    }
    const type = step.type as NodeType;
    const def = NODE_REGISTRY[type];
    nodes.push({
      id: step.id,
      type,
      position: { x: 0, y: 0 },
      data: { label: (step.label || def.label).slice(0, 80), config: { ...(def.defaults() as Record<string, unknown>), ...(step.config ?? {}) } },
    });
  }

  const edges: FlowEdge[] = [];
  const types = new Map(nodes.map((n) => [n.id, n.type]));
  for (const step of input.steps) {
    const type = types.get(step.id);
    if (!type || step.next === undefined || step.next === null || step.next === "") continue;
    const outputs = NODE_REGISTRY[type].outputs.map((o) => o.id);
    const links: [string, string | null][] =
      typeof step.next === "string" ? [[outputs.length === 1 ? outputs[0] : "out", step.next]] : Object.entries(step.next);
    for (const [handle, target] of links) {
      if (!target) continue;
      if (!outputs.includes(handle)) {
        errors.push(
          outputs.length === 0
            ? `Step “${step.id}” (${type}) ends the workflow, so it cannot have "next".`
            : typeof step.next === "string"
              ? `Step “${step.id}” (${type}) has several outputs: set "next" to an object like ${JSON.stringify(Object.fromEntries(outputs.map((o) => [o, "step_id"])))}.`
              : `Step “${step.id}” (${type}) has no output “${handle}”. Its outputs are: ${outputs.join(", ")}.`,
        );
        continue;
      }
      if (!ids.has(target)) {
        errors.push(`Step “${step.id}” links to “${target}”, but there is no step with that id.`);
        continue;
      }
      edges.push({ id: `e_${step.id}_${handle}_${target}`, source: step.id, target, sourceHandle: handle });
    }
  }
  if (!nodes.some((n) => n.type === "trigger")) errors.push(`Add a step of type "trigger" — every workflow starts with one.`);
  if (errors.length) return { definition: null, errors };
  return { definition: { nodes: layoutNodes(nodes, edges), edges }, errors };
}

/** Parses pasted workflow JSON (simple or full format) and validates it. */
export function importFlowJson(text: string): ImportResult {
  const empty = { name: null, description: null, definition: null, issues: [] };
  const extracted = extractJson(text);
  if ("error" in extracted) return { ...empty, errors: [extracted.error] };
  const raw = extracted.value as Record<string, unknown>;
  const meta = {
    name: typeof raw?.name === "string" ? raw.name.trim().slice(0, 120) || null : null,
    description: typeof raw?.description === "string" ? raw.description.trim().slice(0, 500) || null : null,
  };

  let definition: FlowDefinition | null;
  let errors: string[];
  const nodes = Array.isArray(raw?.nodes) ? (raw.nodes as Record<string, unknown>[]) : null;
  if (nodes && nodes.every((n) => n && typeof n === "object" && "position" in n && "data" in n)) {
    const parsed = flowDefinitionSchema.safeParse(raw);
    definition = parsed.success ? parsed.data : null;
    errors = parsed.success ? [] : zodMessages(parsed.error);
  } else {
    const parsed = simpleFlowSchema.safeParse(nodes && !raw.steps ? { ...raw, steps: nodes } : raw);
    if (!parsed.success) return { ...empty, ...meta, errors: zodMessages(parsed.error) };
    ({ definition, errors } = fromSimple(parsed.data));
  }
  if (!definition) return { ...empty, ...meta, errors };
  const validation = validateFlow(definition);
  return { ...meta, definition, errors: [], issues: [...validation.errors, ...validation.warnings] };
}

/** The simple format of a workflow, for asking ChatGPT to change it. */
export function exportFlowJson(definition: FlowDefinition, meta: { name: string; description?: string | null }): string {
  const steps = definition.nodes.map((n) => {
    const outs = definition.edges.filter((e) => e.source === n.id);
    const outputs = NODE_REGISTRY[n.type].outputs.map((o) => o.id);
    let next: string | Record<string, string> | undefined;
    if (outs.length) {
      next =
        outputs.length === 1 && outs.length === 1
          ? outs[0].target
          : Object.fromEntries(outs.map((e) => [e.sourceHandle ?? "out", e.target]));
    }
    return { id: n.id, type: n.type, label: n.data.label || undefined, config: n.data.config, ...(next ? { next } : {}) };
  });
  return JSON.stringify({ name: meta.name, ...(meta.description ? { description: meta.description } : {}), steps }, null, 2);
}

/** Text to paste back into ChatGPT so it corrects its JSON. */
export function fixRequestText(result: Pick<ImportResult, "errors" | "issues">): string {
  const problems = [...result.errors, ...result.issues.map((i) => `${i.level === "error" ? "Error" : "Warning"}: ${i.message}`)];
  return [
    "The workflow JSON has these problems:",
    ...problems.map((p) => `- ${p}`),
    "",
    "Please fix them and send the complete corrected JSON again, in one ```json code block.",
  ].join("\n");
}
