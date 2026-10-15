import type { NodeType } from "@/lib/engine/schema";
import { OPERATOR_LABELS, prettyRef, waitLabel, type ConditionOperator } from "./labels";

/** One-line description shown on the canvas card. */
export function nodeSummary(
  type: NodeType,
  c: Record<string, unknown>,
  names: { mediaNames: Record<string, string>; crm: { id: string; name: string }[] },
): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (type) {
    case "trigger": {
      const who = c.customerType === "new" ? "New customers" : c.customerType === "returning" ? "Returning customers" : "Any customer";
      return c.match === "keywords" ? `${who} · keywords: ${((c.keywords as string[]) ?? []).join(", ") || "none yet"}` : `${who} · any message`;
    }
    case "send_message": {
      const hours = Number(c.cooldownHours) || 0;
      return `${s(c.text)}${hours > 0 ? ` · not repeated within ${hours}h` : ""}`;
    }
    case "send_media":
      return c.assetId ? `File: ${names.mediaNames[s(c.assetId)] ?? "selected file"}` : "No file selected yet";
    case "wait":
      return `Wait ${waitLabel(c.amount, c.unit)}`;
    case "ask_question":
      return `${s(c.question)} → saved as ${s(c.variable) || "?"}`;
    case "interactive":
      return s(c.body);
    case "validation":
      return `Checks ${s(c.variable).replace(/_/g, " ") || "?"} · ${Number(c.maxAttempts) || 0} tries`;
    case "condition": {
      const op = s(c.operator) as ConditionOperator;
      if (op === "customer_is_new" || op === "customer_is_returning") return OPERATOR_LABELS[op];
      if (op === "has_open_enquiry") return `${OPERATOR_LABELS[op]}${s(c.right).trim() ? ` (last ${s(c.right).trim()} days)` : ""}`;
      const left = prettyRef(s(c.left)) || "value";
      if (op === "is_set" || op === "is_not_set") return `If ${left} ${OPERATOR_LABELS[op]}`;
      return `If ${left} ${OPERATOR_LABELS[op] ?? op} “${s(c.right)}”`;
    }
    case "save_lead": {
      const mapping = (c.mapping as Record<string, string>) ?? {};
      const fields = Object.entries(mapping)
        .filter(([, v]) => v?.trim())
        .map(([k]) => k.replace(/_/g, " "));
      return fields.length ? `Saves ${fields.join(", ")}` : "Saves the lead";
    }
    case "crm_webhook":
      return c.integrationId ? `To ${names.crm.find((i) => i.id === c.integrationId)?.name ?? "selected CRM"}` : "To all enabled CRMs";
    case "handoff":
      return s(c.reason);
    case "end":
      return "Flow completed";
  }
}
