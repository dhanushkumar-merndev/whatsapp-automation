import type { NodeType } from "@/lib/engine/schema";

/** One-line description shown on the canvas card. */
export function nodeSummary(type: NodeType, c: Record<string, unknown>, mediaNames: Record<string, string>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (type) {
    case "trigger":
      return c.match === "keywords"
        ? `Keywords: ${((c.keywords as string[]) ?? []).join(", ") || "—"}`
        : `Any message${c.customerType && c.customerType !== "any" ? ` · ${c.customerType} customers` : ""}`;
    case "send_message":
      return s(c.text);
    case "send_media":
      return c.assetId ? `📎 ${mediaNames[s(c.assetId)] ?? "Selected file"}` : "⚠ No file selected";
    case "wait":
      return `Wait ${c.amount} ${c.unit}${c.essential ? " · essential" : ""}`;
    case "ask_question":
      return `${s(c.question)} → {{vars.${s(c.variable)}}}`;
    case "interactive":
      return `${s(c.body)} · ${((c.options as unknown[]) ?? []).length} options`;
    case "validation":
      return `Check {{vars.${s(c.variable)}}} · max ${c.maxAttempts} attempts`;
    case "condition":
      return `${s(c.left)} ${String(c.operator).replace(/_/g, " ")} ${s(c.right)}`.trim();
    case "save_lead":
      return "Create/update lead from answers";
    case "crm_webhook":
      return c.integrationId ? "Selected CRM integration" : "All enabled CRM integrations";
    case "handoff":
      return s(c.reason);
    case "end":
      return "Flow completed";
  }
}
