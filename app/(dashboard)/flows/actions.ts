"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requireAdmin, runAction, type ActionResult } from "@/lib/auth/guard";
import { loadSettings } from "@/lib/settings/server";
import { flowDefinitionSchema, type FlowDefinition } from "@/lib/engine/schema";
import { validateFlow, type GraphValidation } from "@/lib/engine/validate-graph";
import { estimateFlow, estimateSnapshot, type EstimateReport } from "@/lib/estimator/estimate";
import { loadPlanContext } from "@/lib/estimator/plan-context";
import { buildDefaultFlowDefinition, DEFAULT_FLOW_DESCRIPTION, DEFAULT_FLOW_NAME } from "@/lib/flows/default-flow";
import { blankFlowDefinition } from "@/lib/flows/blank-flow";
import {
  buildRealEstateFlowDefinition,
  REAL_ESTATE_FLOW_DESCRIPTION,
  REAL_ESTATE_FLOW_NAME,
  REAL_ESTATE_FLOW_PRIORITY,
} from "@/lib/flows/real-estate-flow";
import { qstashClient } from "@/lib/qstash";

const uuid = z.uuid();

export const assumptionsSchema = z.object({
  customersPerDay: z.number().min(0).max(1_000_000),
  completionRate: z.number().min(0).max(1),
  dailyGrowthRate: z.number().min(-0.5).max(1),
  validationRetriesPerQuestion: z.number().min(0).max(10),
  qstashRetryRate: z.number().min(0).max(1),
  averageMediaSizeMb: z.number().min(0).max(1000),
  newMediaAssetsPerMonth: z.number().min(0).max(10000),
  dbKbPerConversation: z.number().min(0).max(100000),
  outgoingPerCustomerOverride: z.number().min(0).max(1000).nullable().optional(),
  scheduledPerCustomerOverride: z.number().min(0).max(1000).nullable().optional(),
});

async function writeLimits() {
  const s = await loadSettings();
  return { prefix: "admin_write", tokens: s.rateLimits.adminWritesPerMinute, windowSeconds: 60 };
}

// ---------------------------------------------------------------------------

export type FlowTemplate = "blank" | "star_growth_hub" | "real_estate_ads";

export async function createFlowAction(input: { name: string; template: FlowTemplate }) {
  const result = await runAction(async () => {
    const s = await loadSettings();
    const session = await requireAdmin({
      limit: { prefix: "flow_create", tokens: s.rateLimits.flowCreatesPerHour, windowSeconds: 3600 },
    });
    const template = z.enum(["blank", "star_growth_hub", "real_estate_ads"]).parse(input.template);
    const defaultName = { blank: "Untitled flow", star_growth_hub: DEFAULT_FLOW_NAME, real_estate_ads: REAL_ESTATE_FLOW_NAME }[template];
    const name = z.string().trim().min(1).max(120).parse(input.name || defaultName);
    let definition: FlowDefinition = template === "real_estate_ads" ? buildRealEstateFlowDefinition() : blankFlowDefinition();
    if (template === "star_growth_hub") {
      const { data: brochure } = await createAdminClient()
        .from("media_assets")
        .select("id")
        .eq("kind", "document")
        .eq("status", "ready")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      definition = buildDefaultFlowDefinition(brochure?.id ?? null);
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("flows")
      .insert({
        name,
        description: template === "star_growth_hub" ? DEFAULT_FLOW_DESCRIPTION : template === "real_estate_ads" ? REAL_ESTATE_FLOW_DESCRIPTION : null,
        // Keyword flows must outrank the catch-all enquiry flow.
        ...(template === "real_estate_ads" ? { priority: REAL_ESTATE_FLOW_PRIORITY } : {}),
        draft_definition: definition,
        created_by: session.userId,
        updated_by: session.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(session, "flow.created", { type: "flow", id: data.id }, { template });
    return data.id as string;
  });
  if (result.ok && result.data) redirect(`/flows/${result.data}`);
  return result;
}

export async function saveDraftAction(input: {
  flowId: string;
  definition: FlowDefinition;
  expectedDraftUpdatedAt: string | null;
}): Promise<ActionResult<{ draftUpdatedAt: string }>> {
  return runAction(async () => {
    const session = await requireAdmin({ limit: await writeLimits() });
    const flowId = uuid.parse(input.flowId);
    const definition = flowDefinitionSchema.parse(input.definition);
    const supabase = await createClient();
    const { data: current, error: readError } = await supabase
      .from("flows")
      .select("draft_updated_at, status")
      .eq("id", flowId)
      .single();
    if (readError) throw new Error(readError.message);
    if (current.status === "archived") throw new Error("Archived flows cannot be edited. Duplicate it instead.");
    if (input.expectedDraftUpdatedAt && current.draft_updated_at !== input.expectedDraftUpdatedAt) {
      throw new Error("This flow was changed in another window. Reload the page to get the latest version before saving.");
    }
    const draftUpdatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("flows")
      .update({ draft_definition: definition, draft_updated_at: draftUpdatedAt, updated_by: session.userId })
      .eq("id", flowId);
    if (error) throw new Error(error.message);
    return { draftUpdatedAt };
  });
}

export async function updateFlowDetailsAction(input: { flowId: string; name: string; description: string; priority: number }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: await writeLimits() });
    const parsed = z
      .object({
        flowId: uuid,
        name: z.string().trim().min(1).max(120),
        description: z.string().max(500),
        priority: z.number().int().min(0).max(1000),
      })
      .parse(input);
    const supabase = await createClient();
    const { error } = await supabase
      .from("flows")
      .update({ name: parsed.name, description: parsed.description || null, priority: parsed.priority, updated_by: session.userId })
      .eq("id", parsed.flowId);
    if (error) throw new Error(error.message);
    await audit(session, "flow.updated", { type: "flow", id: parsed.flowId });
    revalidatePath("/flows");
  });
}

async function buildPublishReport(flowId: string, flowName: string, definition: FlowDefinition, assumptions: z.infer<typeof assumptionsSchema>) {
  const settings = await loadSettings();
  const plan = await loadPlanContext(settings, flowId);
  const validation = validateFlow(definition);
  const report = estimateFlow({ flowName, definition, assumptions, plan });
  return { validation, report };
}

/** Server-side (authoritative) validation + usage report shown before publishing. */
export async function previewPublishAction(input: {
  flowId: string;
  definition: FlowDefinition;
  assumptions: z.infer<typeof assumptionsSchema>;
}): Promise<ActionResult<{ validation: GraphValidation; report: EstimateReport }>> {
  return runAction(async () => {
    await requireAdmin();
    const flowId = uuid.parse(input.flowId);
    const definition = flowDefinitionSchema.parse(input.definition);
    const assumptions = assumptionsSchema.parse(input.assumptions);
    const supabase = await createClient();
    const { data: flow, error } = await supabase.from("flows").select("name").eq("id", flowId).single();
    if (error) throw new Error(error.message);
    return buildPublishReport(flowId, flow.name, definition, assumptions);
  });
}

export async function publishFlowAction(input: {
  flowId: string;
  definition: FlowDefinition;
  assumptions: z.infer<typeof assumptionsSchema>;
  mode: "active" | "testing";
  note: string;
  acknowledgeWarnings: boolean;
}): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const s = await loadSettings();
    const session = await requireAdmin({
      limit: { prefix: "flow_publish", tokens: s.rateLimits.flowPublishesPerHour, windowSeconds: 3600 },
    });
    const flowId = uuid.parse(input.flowId);
    const definition = flowDefinitionSchema.parse(input.definition);
    const assumptions = assumptionsSchema.parse(input.assumptions);
    const mode = z.enum(["active", "testing"]).parse(input.mode);
    const supabase = await createClient();
    const { data: flow, error } = await supabase.from("flows").select("id, name, status").eq("id", flowId).single();
    if (error) throw new Error(error.message);
    if (flow.status === "archived") throw new Error("Archived flows cannot be published.");

    const { validation, report } = await buildPublishReport(flowId, flow.name, definition, assumptions);
    if (!validation.ok) throw new Error(`Fix ${validation.errors.length} error(s) before publishing: ${validation.errors[0].message}`);
    if (report.overallLevel !== "normal" && !input.acknowledgeWarnings) {
      throw new Error("Review and acknowledge the usage warnings before publishing.");
    }

    const { data: last } = await supabase
      .from("flow_versions")
      .select("version")
      .eq("flow_id", flowId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (last?.version ?? 0) + 1;
    const { data: created, error: insertError } = await supabase
      .from("flow_versions")
      .insert({
        flow_id: flowId,
        version,
        definition,
        estimate_report: report,
        note: input.note.trim().slice(0, 500) || null,
        published_by: session.userId,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("flows")
      .update({
        published_version_id: created.id,
        status: mode,
        estimate_snapshot: estimateSnapshot(report),
        draft_definition: definition,
        draft_updated_at: now,
        updated_by: session.userId,
      })
      .eq("id", flowId);
    if (updateError) throw new Error(updateError.message);

    await audit(session, "flow.published", { type: "flow", id: flowId }, { version, mode, level: report.overallLevel });
    revalidatePath("/flows");
    revalidatePath(`/flows/${flowId}`);
    return { version };
  });
}

/** Cancels pending delayed jobs of a flow (DB + QStash) and parks their executions. */
async function cancelFlowJobs(flowId: string) {
  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("scheduled_jobs")
    .update({ status: "cancelled", last_error: "flow_paused" })
    .eq("flow_id", flowId)
    .eq("status", "scheduled")
    .select("id, execution_id, qstash_message_id");
  for (const j of jobs ?? []) {
    if (j.qstash_message_id) {
      try {
        await qstashClient().messages.cancel(j.qstash_message_id);
      } catch (e) {
        console.warn("[flows] QStash cancel failed", j.qstash_message_id, e instanceof Error ? e.message : e);
      }
    }
  }
  await admin
    .from("flow_executions")
    .update({ status: "paused", awaiting: null, error: "Flow paused by an administrator", completed_at: new Date().toISOString() })
    .eq("flow_id", flowId)
    .eq("status", "waiting_delay");
  return jobs?.length ?? 0;
}

export async function setFlowStatusAction(input: { flowId: string; status: "active" | "testing" | "paused" | "archived" | "draft" }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: await writeLimits() });
    const flowId = uuid.parse(input.flowId);
    const status = z.enum(["active", "testing", "paused", "archived", "draft"]).parse(input.status);
    const supabase = await createClient();
    const { data: flow, error } = await supabase.from("flows").select("published_version_id, status").eq("id", flowId).single();
    if (error) throw new Error(error.message);
    if ((status === "active" || status === "testing") && !flow.published_version_id) {
      throw new Error("Publish the flow before activating it.");
    }
    const { error: updateError } = await supabase.from("flows").update({ status, updated_by: session.userId }).eq("id", flowId);
    if (updateError) throw new Error(updateError.message);
    let cancelled = 0;
    if (status === "paused" || status === "archived" || status === "draft") cancelled = await cancelFlowJobs(flowId);
    await audit(session, `flow.${status}`, { type: "flow", id: flowId }, { cancelledJobs: cancelled });
    revalidatePath("/flows");
    revalidatePath(`/flows/${flowId}`);
    return { cancelled };
  });
}

export async function duplicateFlowAction(input: { flowId: string }) {
  const result = await runAction(async () => {
    const session = await requireAdmin({ limit: await writeLimits() });
    const flowId = uuid.parse(input.flowId);
    const supabase = await createClient();
    const { data: flow, error } = await supabase
      .from("flows")
      .select("name, description, draft_definition, priority")
      .eq("id", flowId)
      .single();
    if (error) throw new Error(error.message);
    const { data, error: insertError } = await supabase
      .from("flows")
      .insert({
        name: `${flow.name} (copy)`.slice(0, 120),
        description: flow.description,
        draft_definition: flow.draft_definition,
        priority: flow.priority,
        created_by: session.userId,
        updated_by: session.userId,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    await audit(session, "flow.duplicated", { type: "flow", id: data.id }, { from: flowId });
    return data.id as string;
  });
  if (result.ok && result.data) redirect(`/flows/${result.data}`);
  return result;
}

/** Make an earlier immutable version the live one again (and load it into the draft). */
export async function rollbackFlowAction(input: { flowId: string; versionId: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: await writeLimits() });
    const flowId = uuid.parse(input.flowId);
    const versionId = uuid.parse(input.versionId);
    const supabase = await createClient();
    const { data: v, error } = await supabase
      .from("flow_versions")
      .select("id, version, definition, estimate_report")
      .eq("id", versionId)
      .eq("flow_id", flowId)
      .single();
    if (error) throw new Error(error.message);
    const report = v.estimate_report as EstimateReport | null;
    const { error: updateError } = await supabase
      .from("flows")
      .update({
        published_version_id: v.id,
        draft_definition: v.definition,
        draft_updated_at: new Date().toISOString(),
        estimate_snapshot: report ? estimateSnapshot(report) : null,
        updated_by: session.userId,
      })
      .eq("id", flowId);
    if (updateError) throw new Error(updateError.message);
    await audit(session, "flow.rolled_back", { type: "flow", id: flowId }, { version: v.version });
    revalidatePath(`/flows/${flowId}`);
    return { version: v.version as number };
  });
}

export async function restoreVersionToDraftAction(input: { flowId: string; versionId: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: await writeLimits() });
    const flowId = uuid.parse(input.flowId);
    const supabase = await createClient();
    const { data: v, error } = await supabase
      .from("flow_versions")
      .select("definition, version")
      .eq("id", uuid.parse(input.versionId))
      .eq("flow_id", flowId)
      .single();
    if (error) throw new Error(error.message);
    const { error: updateError } = await supabase
      .from("flows")
      .update({ draft_definition: v.definition, draft_updated_at: new Date().toISOString(), updated_by: session.userId })
      .eq("id", flowId);
    if (updateError) throw new Error(updateError.message);
    await audit(session, "flow.version_restored_to_draft", { type: "flow", id: flowId }, { version: v.version });
    revalidatePath(`/flows/${flowId}`);
  });
}
