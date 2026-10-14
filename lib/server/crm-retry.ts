import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { attemptCrmDelivery } from "@/lib/engine/crm-attempt";
import { buildCrmPayload, leadSubmittedEventId } from "@/lib/engine/crm-payload";
import { createPipelineDeps } from "./pipeline";
import { SupabaseStore } from "./supabase-store";

/**
 * Manual "retry CRM sync" for one lead: re-attempts every enabled integration
 * with the same stable event id (the CRM can de-duplicate on it).
 */
export async function retryLeadCrmSync(leadId: string) {
  const deps = await createPipelineDeps("crm.manual_retry");
  const store = deps.store as SupabaseStore;
  const lead = await store.getLead(leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.status === "incomplete") throw new Error("This enquiry is incomplete — it is sent to the CRM once the lead is saved.");
  const integrations = await store.listCrmIntegrations({ enabledOnly: true });
  if (!integrations.length) throw new Error("No enabled CRM integration. Add one under CRM Integrations.");
  const results: string[] = [];
  for (const integration of integrations) {
    const eventId = leadSubmittedEventId(lead.id);
    const payload = buildCrmPayload({ lead, eventId, eventType: "lead.submitted", mapping: integration.fieldMapping, occurredAt: new Date().toISOString() });
    const { delivery } = await store.createCrmDelivery({ integrationId: integration.id, leadId: lead.id, eventId, eventType: "lead.submitted", payload, isTest: lead.isTest });
    if (delivery.status === "succeeded") {
      results.push(`${integration.name}: already delivered`);
      continue;
    }
    // A manual retry starts a fresh attempt budget and refreshes the payload with the latest lead data.
    await createAdminClient().from("crm_deliveries").update({ attempts: 0, status: "pending", payload }).eq("id", delivery.id);
    const outcome = await attemptCrmDelivery(deps, integration, { ...delivery, attempts: 0, status: "pending", payload });
    results.push(`${integration.name}: ${outcome}`);
  }
  return results;
}
