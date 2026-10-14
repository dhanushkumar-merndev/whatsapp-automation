import { FlowGraph } from "@/lib/engine/graph";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import { safeParseNodeConfig, type FlowDefinition, type NodeType } from "@/lib/engine/schema";

/**
 * Static analysis of a flow graph into per-customer resource counts.
 *
 * Only actions that really consume a resource are counted:
 *   - WhatsApp: nodes that send a message (+ validation error replies).
 *   - QStash: Wait nodes (each schedules exactly one delayed delivery) and,
 *     in the worst case, CRM retry jobs. Immediate node transitions run
 *     synchronously and cost nothing.
 * Typical values are probability-weighted (branches, drop-off, retries);
 * worst-case values follow the most expensive path with every retry.
 */

export interface PerCustomer {
  outgoing: number;
  scheduled: number;
  inbound: number;
  crmDeliveries: number;
  mediaSends: number;
}

export interface FlowAnalysis {
  typical: PerCustomer;
  worst: PerCustomer;
  questionCount: number;
  waitCount: number;
  sendNodeCount: number;
  hasCrm: boolean;
  /** Node ids on the analysed graph (reachable from the trigger). */
  reachable: number;
}

export interface AnalyzeOptions {
  completionRate: number;
  /** Expected invalid answers per validation step per customer. */
  validationRetriesPerQuestion: number;
  /** Max QStash retries per delivery (worst case). */
  qstashMaxRetries: number;
  /** Max CRM delivery attempts (first attempt is inline, the rest are QStash jobs). */
  crmMaxAttempts: number;
}

const INPUT: NodeType[] = ["ask_question", "interactive"];
/** Assumed share of conversations that are follow-ups from customers with an open enquiry. */
export const FOLLOW_UP_SHARE = 0.1;
const zero = (): PerCustomer => ({ outgoing: 0, scheduled: 0, inbound: 0, crmDeliveries: 0, mediaSends: 0 });

function add(a: PerCustomer, b: PerCustomer, k = 1): PerCustomer {
  return {
    outgoing: a.outgoing + b.outgoing * k,
    scheduled: a.scheduled + b.scheduled * k,
    inbound: a.inbound + b.inbound * k,
    crmDeliveries: a.crmDeliveries + b.crmDeliveries * k,
    mediaSends: a.mediaSends + b.mediaSends * k,
  };
}

function cfg(node: { type: NodeType; data: { config: unknown } }): Record<string, unknown> {
  const parsed = safeParseNodeConfig(node.type, node.data.config);
  return (parsed.success ? parsed.data : NODE_REGISTRY[node.type].defaults()) as Record<string, unknown>;
}

export function analyzeFlow(def: FlowDefinition, opts: AnalyzeOptions): FlowAnalysis {
  const graph = new FlowGraph(def);
  const trigger = graph.trigger();
  const empty: FlowAnalysis = {
    typical: zero(),
    worst: zero(),
    questionCount: 0,
    waitCount: 0,
    sendNodeCount: 0,
    hasCrm: false,
    reachable: 0,
  };
  if (!trigger) return empty;

  // 1. DFS from the trigger; drop back edges so the graph becomes a DAG.
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const dagEdges = new Map<string, { target: string; handle: string }[]>();
  const visit = (id: string) => {
    state.set(id, 1);
    const out: { target: string; handle: string }[] = [];
    for (const e of graph.edgesFrom(id)) {
      if (!graph.nodes.has(e.target)) continue;
      const s = state.get(e.target);
      if (s === 1) continue; // back edge (loop) — ignored for estimation
      out.push({ target: e.target, handle: e.sourceHandle ?? "out" });
      if (!s) visit(e.target);
    }
    dagEdges.set(id, out);
    state.set(id, 2);
    order.push(id);
  };
  visit(trigger.id);
  const topo = order.reverse();

  // 2. Longest number of question steps on any path (for drop-off per step).
  const questionsTo = new Map<string, number>();
  let maxQuestions = 0;
  for (const id of topo) {
    const node = graph.get(id)!;
    const here = (questionsTo.get(id) ?? 0) + (INPUT.includes(node.type) ? 1 : 0);
    maxQuestions = Math.max(maxQuestions, here);
    for (const e of dagEdges.get(id) ?? []) questionsTo.set(e.target, Math.max(questionsTo.get(e.target) ?? 0, here));
  }
  const completion = Math.min(1, Math.max(0, opts.completionRate));
  const survival = maxQuestions > 0 ? completion ** (1 / maxQuestions) : 1;
  const r = Math.max(0, opts.validationRetriesPerQuestion);
  const q = r / (1 + r); // probability that a given answer is invalid

  // 3. Forward pass: probability mass reaching each node → typical counts.
  const reach = new Map<string, number>([[trigger.id, 1]]);
  let typical = zero();
  let questionCount = 0;
  let waitCount = 0;
  let sendNodeCount = 0;
  let hasCrm = false;

  for (const id of topo) {
    const node = graph.get(id)!;
    const p = reach.get(id) ?? 0;
    const c = cfg(node);
    const own = zero();
    let pass: Record<string, number> = { out: 1 };

    switch (node.type) {
      case "send_message":
        own.outgoing = 1;
        sendNodeCount++;
        break;
      case "send_media":
        if (c.assetId) {
          own.outgoing = 1;
          own.mediaSends = 1;
        }
        sendNodeCount++;
        break;
      case "wait":
        own.scheduled = 1;
        waitCount++;
        break;
      case "ask_question":
      case "interactive":
        own.outgoing = 1;
        own.inbound = survival;
        pass = { out: survival };
        questionCount++;
        sendNodeCount++;
        break;
      case "validation": {
        const max = Math.max(1, Number(c.maxAttempts ?? 3));
        let errors = 0;
        for (let i = 1; i < max; i++) errors += q ** i;
        own.outgoing = errors;
        own.inbound = errors;
        const exhausted = q ** max;
        pass = { valid: 1 - exhausted, invalid: exhausted };
        break;
      }
      case "condition":
        // Follow-ups from customers with an open enquiry are a minority of conversations.
        pass = c.operator === "has_open_enquiry" ? { true: FOLLOW_UP_SHARE, false: 1 - FOLLOW_UP_SHARE } : { true: 0.5, false: 0.5 };
        break;
      case "crm_webhook":
        own.crmDeliveries = 1;
        hasCrm = true;
        break;
      case "handoff":
        own.outgoing = String(c.message ?? "").trim() ? 1 : 0;
        pass = {};
        sendNodeCount++;
        break;
      case "end":
        pass = {};
        break;
    }
    typical = add(typical, own, p);
    for (const e of dagEdges.get(id) ?? []) {
      const share = pass[e.handle] ?? 0;
      reach.set(e.target, (reach.get(e.target) ?? 0) + p * share);
    }
  }

  // 4. Backward pass: most expensive path with all retries → worst case.
  const worstFrom = new Map<string, PerCustomer>();
  for (const id of [...topo].reverse()) {
    const node = graph.get(id)!;
    const c = cfg(node);
    const own = zero();
    switch (node.type) {
      case "send_message":
        own.outgoing = 1;
        break;
      case "send_media":
        own.outgoing = c.assetId ? 1 : 0;
        own.mediaSends = c.assetId ? 1 : 0;
        break;
      case "wait":
        own.scheduled = 1 + opts.qstashMaxRetries;
        break;
      case "ask_question":
      case "interactive":
        own.outgoing = 1;
        own.inbound = 1;
        break;
      case "validation": {
        const max = Math.max(1, Number(c.maxAttempts ?? 3));
        own.outgoing = max - 1;
        own.inbound = max - 1;
        break;
      }
      case "crm_webhook":
        own.crmDeliveries = opts.crmMaxAttempts;
        own.scheduled = Math.max(0, opts.crmMaxAttempts - 1);
        break;
      case "handoff":
        own.outgoing = String(c.message ?? "").trim() ? 1 : 0;
        break;
    }
    // Each resource takes its own most expensive branch (an upper bound per resource).
    const best = zero();
    for (const e of dagEdges.get(id) ?? []) {
      const child = worstFrom.get(e.target) ?? zero();
      for (const k of Object.keys(best) as (keyof PerCustomer)[]) best[k] = Math.max(best[k], child[k]);
    }
    worstFrom.set(id, add(own, best));
  }

  return {
    typical,
    worst: worstFrom.get(trigger.id) ?? zero(),
    questionCount,
    waitCount,
    sendNodeCount,
    hasCrm,
    reachable: topo.length,
  };
}
