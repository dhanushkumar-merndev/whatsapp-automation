/**
 * Seeds data that depends on your environment:
 *   1. registers the WhatsApp number from META_WABA_ID / META_PHONE_NUMBER_ID
 *   2. creates the default "Star Growth Hub — Enquiry" flow and publishes v1
 *      (with a usage report from the estimator) if no flows exist yet.
 * Safe to run repeatedly.   pnpm db:seed
 */
import { loadEnv, required } from "./_env";
import { adminClient } from "./_admin";
import { parseSettings } from "../lib/settings/schema";
import { buildDefaultFlowDefinition, DEFAULT_FLOW_DESCRIPTION, DEFAULT_FLOW_NAME } from "../lib/flows/default-flow";
import { validateFlow } from "../lib/engine/validate-graph";
import { estimateFlow, estimateSnapshot } from "../lib/estimator/estimate";
import { buildPlanContext, defaultAssumptions, type PlanLimitRow } from "../lib/estimator/plan-rows";

loadEnv();

async function main() {
  const admin = adminClient();
  const wabaId = required("META_WABA_ID");
  const phoneNumberId = required("META_PHONE_NUMBER_ID");

  const { data: account } = await admin.from("whatsapp_accounts").select("id").eq("phone_number_id", phoneNumberId).maybeSingle();
  if (account) {
    console.log("• WhatsApp number already registered");
  } else {
    const { error } = await admin.from("whatsapp_accounts").insert({ name: "Star Growth Hub", waba_id: wabaId, phone_number_id: phoneNumberId });
    if (error) throw error;
    console.log("✓ Registered WhatsApp number (phone number ID from .env)");
  }

  const { count } = await admin.from("flows").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    console.log("• Flows already exist — default flow not re-created");
    return;
  }
  const { data: owner } = await admin.from("profiles").select("id").eq("role", "owner").limit(1).maybeSingle();
  const { data: brochure } = await admin
    .from("media_assets")
    .select("id")
    .eq("kind", "document")
    .eq("status", "ready")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const definition = buildDefaultFlowDefinition(brochure?.id ?? null);
  const validation = validateFlow(definition);
  if (!validation.ok) throw new Error(`Default flow is invalid: ${validation.errors[0].message}`);

  const { data: settingsRow } = await admin.from("app_settings").select("settings").eq("id", 1).maybeSingle();
  const settings = parseSettings(settingsRow?.settings ?? {});
  const { data: limits } = await admin.from("plan_limits").select("*");
  const { data: storage } = await admin.rpc("get_storage_usage");
  const plan = buildPlanContext({ settings, limits: (limits ?? []) as PlanLimitRow[], flows: [], storage });
  const report = estimateFlow({ flowName: DEFAULT_FLOW_NAME, definition, assumptions: defaultAssumptions(settings), plan });

  const { data: flow, error: flowError } = await admin
    .from("flows")
    .insert({
      name: DEFAULT_FLOW_NAME,
      description: DEFAULT_FLOW_DESCRIPTION,
      draft_definition: definition,
      is_default: true,
      created_by: owner?.id ?? null,
      updated_by: owner?.id ?? null,
    })
    .select("id")
    .single();
  if (flowError) throw flowError;
  const { data: version, error: vError } = await admin
    .from("flow_versions")
    .insert({ flow_id: flow.id, version: 1, definition, estimate_report: report, note: "Initial default flow", published_by: owner?.id ?? null })
    .select("id")
    .single();
  if (vError) throw vError;
  const { error: uError } = await admin
    .from("flows")
    .update({ published_version_id: version.id, status: "active", estimate_snapshot: estimateSnapshot(report) })
    .eq("id", flow.id);
  if (uError) throw uError;
  await admin.from("audit_logs").insert({ actor_type: "system", action: "flow.seeded", entity_type: "flow", entity_id: flow.id });

  console.log(`✓ Created and published "${DEFAULT_FLOW_NAME}" (v1, active)`);
  console.log(`  Usage: ${report.daily.whatsappReplies} replies/day, ${report.daily.qstashDeliveries} QStash/day at ${report.assumptions.customersPerDay} customers/day — ${report.overallLevel}`);
  if (!brochure) console.log("  ⚠ No brochure uploaded yet: upload a PDF in Media Library and select it in the “Company brochure” node, then publish.");
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  process.exitCode = 1;
});
