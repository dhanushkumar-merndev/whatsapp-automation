import { FlowGraph } from "./graph";
import { parseNodeConfig, type FlowDefinition, type TriggerConfig } from "./schema";
import type { InboundInput } from "./types";

function norm(s: string) {
  return s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

export function triggerMatches(cfg: TriggerConfig, input: InboundInput, isNewCustomer: boolean): boolean {
  if (cfg.customerType === "new" && !isNewCustomer) return false;
  if (cfg.customerType === "returning" && isNewCustomer) return false;
  if (cfg.match === "any") return true;
  const text = norm(input.replyTitle ?? input.text ?? "");
  if (!text) return false;
  return cfg.keywords.some((k) => {
    const kw = norm(k);
    if (!kw) return false;
    if (cfg.matchMode === "exact") return text === kw;
    if (cfg.matchMode === "starts_with") return text.startsWith(kw);
    return new RegExp(`(^|[^\\p{L}\\p{N}])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text);
  });
}

export interface TriggerCandidate {
  flowId: string;
  versionId: string;
  priority: number;
  definition: FlowDefinition;
}

/**
 * Picks the flow to start for an inbound message. Lower priority number wins;
 * on ties, keyword triggers win over catch-all triggers so specific flows are
 * not shadowed by the default flow.
 */
export function selectTrigger(
  candidates: TriggerCandidate[],
  input: InboundInput,
  isNewCustomer: boolean,
): TriggerCandidate | null {
  const matches = candidates
    .map((c) => {
      const trigger = new FlowGraph(c.definition).trigger();
      if (!trigger) return null;
      const cfg = parseNodeConfig("trigger", trigger.data.config);
      return triggerMatches(cfg, input, isNewCustomer) ? { c, specific: cfg.match === "keywords" ? 0 : 1 } : null;
    })
    .filter((m): m is { c: TriggerCandidate; specific: number } => m !== null)
    .sort((a, b) => a.c.priority - b.c.priority || a.specific - b.specific);
  return matches[0]?.c ?? null;
}
