import { FlowGraph } from "./graph";
import { NODE_REGISTRY, outputsFor } from "./registry";
import { MAX_MULTI_OPTIONS } from "./interactive";
import { safeParseNodeConfig, type FlowDefinition, type NodeType } from "./schema";
import { checkPattern } from "./validate-answer";
import { templateVariables } from "./template";
import { definedVariableNames } from "./variables";

export interface GraphIssue {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
}

export interface GraphValidation {
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
}

const INPUT_NODES: NodeType[] = ["ask_question", "interactive", "booking", "whatsapp_form", "validation"];

/**
 * Static checks run continuously in the editor and again before publishing.
 * Errors block publishing; warnings are shown but do not block.
 */
export function validateFlow(def: FlowDefinition): GraphValidation {
  const issues: GraphIssue[] = [];
  const err = (message: string, nodeId?: string) => issues.push({ level: "error", message, nodeId });
  const warn = (message: string, nodeId?: string) => issues.push({ level: "warning", message, nodeId });
  const graph = new FlowGraph(def);
  const label = (id: string) => graph.get(id)?.data.label || NODE_REGISTRY[graph.get(id)!.type].label;

  // Trigger ----------------------------------------------------------------
  const triggers = def.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) err("Add a “Customer message” trigger — flows only start when a customer messages first.");
  if (triggers.length > 1) for (const t of triggers.slice(1)) err("Only one trigger is allowed per flow.", t.id);

  // Node ids and edges -------------------------------------------------------
  const ids = new Set<string>();
  for (const n of def.nodes) {
    if (ids.has(n.id)) err(`Duplicate node id ${n.id}`, n.id);
    ids.add(n.id);
  }
  const seenHandles = new Set<string>();
  for (const e of def.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      err("A connection points to a node that no longer exists.");
      continue;
    }
    const target = graph.get(e.target)!;
    if (target.type === "trigger") err("The trigger cannot have incoming connections.", target.id);
    if (e.source === e.target) err("A node cannot connect to itself.", e.source);
    const source = graph.get(e.source)!;
    const handle = e.sourceHandle ?? "out";
    const outputs = outputsFor(source.type, source.data.config).map((o) => o.id);
    if (!outputs.includes(handle)) {
      err(
        handle === "no_reply"
          ? `“${label(source.id)}” has a “No reply” connection but no reply timer is set.`
          : handle === "invalid" && source.type === "ask_question"
            ? `“${label(source.id)}” has a “Failed” connection, but plain text answers are never rejected. Choose an answer type or remove it.`
            : `“${label(source.id)}” has no output named “${handle}”.`,
        source.id,
      );
    }
    const key = `${e.source}:${handle}`;
    if (seenHandles.has(key)) err(`“${label(source.id)}” has more than one connection from the same output.`, source.id);
    seenHandles.add(key);
  }

  // Per-node configuration -----------------------------------------------------
  const variablesSet = definedVariableNames(def);
  for (const n of def.nodes) {
    const parsed = safeParseNodeConfig(n.type, n.data.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 3)) {
        err(`“${label(n.id)}”: ${issue.path.join(".") || "config"} — ${issue.message}`, n.id);
      }
      continue;
    }
    const cfg = parsed.data as Record<string, unknown>;
    if (n.type === "interactive") {
      const opts = cfg.options as { id: string }[];
      const dupes = opts.map((o) => o.id).filter((id, i, a) => a.indexOf(id) !== i);
      if (dupes.length) err(`“${label(n.id)}”: option IDs must be unique (${[...new Set(dupes)].join(", ")}).`, n.id);
      if (cfg.selection === "multiple") {
        const min = cfg.minSelect as number;
        const max = cfg.maxSelect as number | null;
        if (opts.length > MAX_MULTI_OPTIONS && cfg.mode !== "text") {
          warn(`“${label(n.id)}”: more than ${MAX_MULTI_OPTIONS} options can't fit in a list with “Done”, so they are sent as numbered text.`, n.id);
        }
        if (min > opts.length) err(`“${label(n.id)}”: at least ${min} choices are required but there are only ${opts.length} options.`, n.id);
        if (max !== null && max < min) err(`“${label(n.id)}”: the maximum number of choices is lower than the minimum.`, n.id);
      }
    }
    if (n.type === "booking") {
      const [sh, sm] = String(cfg.startTime).split(":").map(Number);
      const [eh, em] = String(cfg.endTime).split(":").map(Number);
      if (eh * 60 + em - (sh * 60 + sm) < (cfg.slotMinutes as number)) {
        err(`“${label(n.id)}”: the opening hours are shorter than one ${cfg.slotMinutes}-minute slot.`, n.id);
      }
      if ((cfg.reminderHours as number) > 0 && !cfg.reminderTemplate) {
        warn(`“${label(n.id)}”: reminders more than 24 hours after the customer's last message need an approved template; without one they are skipped.`, n.id);
      }
    }
    if (n.type === "send_template" && !cfg.name) err(`“${label(n.id)}”: choose a template.`, n.id);
    if (n.type === "api_request" && !/^https?:\/\/[^\s/{}]+/i.test(cfg.url as string)) {
      err(`“${label(n.id)}”: the URL must start with https:// and a fixed host name.`, n.id);
    }
    if (n.type === "send_message" && Boolean(cfg.buttonText) !== Boolean(cfg.buttonUrl)) {
      warn(`“${label(n.id)}”: set both the button text and its link, or neither.`, n.id);
    }
    if (n.type === "ask_question" && cfg.inputType === "number" && cfg.min !== null && cfg.max !== null && (cfg.min as number) > (cfg.max as number)) {
      err(`“${label(n.id)}”: the smallest allowed number is greater than the largest.`, n.id);
    }
    if (n.type === "validation") {
      const patternError = checkPattern(cfg.pattern as string);
      if (patternError) err(`“${label(n.id)}”: invalid regular expression — ${patternError}`, n.id);
      const min = cfg.minLength as number | null;
      const max = cfg.maxLength as number | null;
      if (min !== null && max !== null && min > max) err(`“${label(n.id)}”: minimum length is greater than maximum.`, n.id);
    }
    if (n.type === "send_media" && !cfg.assetId) warn(`“${label(n.id)}”: no file selected — this step will be skipped.`, n.id);
    if (n.type === "trigger" && cfg.match === "keywords" && (cfg.keywords as string[]).length === 0) {
      err("Keyword trigger needs at least one keyword.", n.id);
    }
    if (n.type === "condition" && cfg.operator === "matches_regex") {
      const patternError = checkPattern(cfg.right as string);
      if (patternError) err(`“${label(n.id)}”: invalid regular expression — ${patternError}`, n.id);
    }
  }

  // Outputs connected? -------------------------------------------------------------
  for (const n of def.nodes) {
    for (const out of outputsFor(n.type, n.data.config)) {
      if (graph.next(n.id, out.id)) continue;
      if (out.id === "no_reply") {
        warn(`“${label(n.id)}”: a reply timer is set, but nothing is connected to “No reply”.`, n.id);
        continue;
      }
      if (out.optional) continue;
      if (n.type === "validation" && out.id === "invalid") {
        warn(`“${label(n.id)}”: the “Failed” branch is not connected — the flow will end. Consider a Human handoff.`, n.id);
      } else if (n.type === "condition") {
        warn(`“${label(n.id)}”: the “${out.label}” branch is not connected — the flow will end there.`, n.id);
      } else {
        warn(`“${label(n.id)}” has no next step — the flow will complete after it.`, n.id);
      }
    }
  }

  // Reachability ----------------------------------------------------------------------
  const trigger = triggers[0];
  if (trigger) {
    const seen = new Set<string>();
    const stack = [trigger.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of graph.edgesFrom(id)) stack.push(e.target);
    }
    for (const n of def.nodes) if (!seen.has(n.id)) warn(`“${label(n.id)}” is not connected to the trigger and will never run.`, n.id);
  }

  // Cycles must pass through a node that waits for the customer -------------------------
  for (const cycle of findCycles(graph)) {
    const waits = cycle.some((id) => INPUT_NODES.includes(graph.get(id)!.type));
    if (!waits) err("This loop never waits for the customer and would repeat forever.", cycle[0]);
  }

  // Variable references ----------------------------------------------------------------
  for (const n of def.nodes) {
    if (n.type === "validation") {
      const v = (n.data.config as { variable?: string }).variable;
      if (v && !variablesSet.has(v)) warn(`“${label(n.id)}” validates “${v}”, but no question stores that variable.`, n.id);
      const upstream = graph.edgesTo(n.id).map((e) => graph.get(e.source)?.type);
      if (!upstream.some((t) => t === "ask_question" || t === "interactive")) {
        warn(`“${label(n.id)}” should come directly after the question it validates so it can re-ask.`, n.id);
      }
    }
    for (const text of collectTemplates(n.data.config)) {
      for (const ref of templateVariables(text)) {
        const [root, name] = ref.split(".");
        if (root === "vars" && name && !variablesSet.has(name)) {
          warn(`“${label(n.id)}” uses {{${ref}}}, which no question sets.`, n.id);
        }
      }
    }
  }

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

function collectTemplates(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.includes("{{")) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectTemplates(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectTemplates(v, out);
  }
  return out;
}

/** Returns one representative node list per strongly connected cycle (Tarjan). */
function findCycles(graph: FlowGraph): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const e of graph.edgesFrom(v)) {
      const w = e.target;
      if (!graph.nodes.has(w)) continue;
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      const selfLoop = graph.edgesFrom(v).some((e) => e.target === v);
      if (comp.length > 1 || selfLoop) result.push(comp);
    }
  };
  for (const id of graph.nodes.keys()) if (!idx.has(id)) visit(id);
  return result;
}
