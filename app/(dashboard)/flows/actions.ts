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
import { blankFlowDefinition } from "@/lib/flows/blank-flow";
import { qstashClient } from "@/lib/qstash";

const uuid = z.uuid();

async function writeLimits() {
  const s = await loadSettings();
  return { prefix: "admin_write", tokens: s.rateLimits.adminWritesPerMinute, windowSeconds: 60 };
}

// ---------------------------------------------------------------------------

export async function createFlowAction(input: { name: string }) {
  const result = await runAction(async () => {
    const s = await loadSettings();
    const session = await requireAdmin({
      limit: { prefix: "flow_create", tokens: s.rateLimits.flowCreatesPerHour, windowSeconds: 3600 },
    });
    const name = z.string().trim().min(1).max(120).parse(input.name || "Untitled workflow");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("flows")
      .insert({ name, draft_definition: blankFlowDefinition(), created_by: session.userId, updated_by: session.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(session, "flow.created", { type: "flow", id: data.id });
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

export async function updateFlowDetailsAction(input: { flowId: string; name: string; description: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: await writeLimits() });
    const parsed = z
      .object({
        flowId: uuid,
        name: z.string().trim().min(1).max(120),
        description: z.string().max(500),
      })
      .parse(input);
    const supabase = await createClient();
    const { error } = await supabase
      .from("flows")
      .update({ name: parsed.name, description: parsed.description || null, updated_by: session.userId })
      .eq("id", parsed.flowId);
    if (error) throw new Error(error.message);
    await audit(session, "flow.updated", { type: "flow", id: parsed.flowId });
    revalidatePath("/flows");
  });
}

/** Server-side (authoritative) validation shown before publishing. */
export async function previewPublishAction(input: { definition: FlowDefinition }): Promise<ActionResult<GraphValidation>> {
  return runAction(async () => {
    await requireAdmin();
    return validateFlow(flowDefinitionSchema.parse(input.definition));
  });
}

export async function publishFlowAction(input: {
  flowId: string;
  definition: FlowDefinition;
  mode: "active" | "testing";
  note: string;
}): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const s = await loadSettings();
    const session = await requireAdmin({
      limit: { prefix: "flow_publish", tokens: s.rateLimits.flowPublishesPerHour, windowSeconds: 3600 },
    });
    const flowId = uuid.parse(input.flowId);
    const definition = flowDefinitionSchema.parse(input.definition);
    const mode = z.enum(["active", "testing"]).parse(input.mode);
    const supabase = await createClient();
    const { data: flow, error } = await supabase.from("flows").select("id, name, status").eq("id", flowId).single();
    if (error) throw new Error(error.message);
    if (flow.status === "archived") throw new Error("Archived flows cannot be published.");

    const validation = validateFlow(definition);
    if (!validation.ok) throw new Error(`Fix ${validation.errors.length} error(s) before publishing: ${validation.errors[0].message}`);

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
        draft_definition: definition,
        draft_updated_at: now,
        updated_by: session.userId,
      })
      .eq("id", flowId);
    if (updateError) throw new Error(updateError.message);

    await audit(session, "flow.published", { type: "flow", id: flowId }, { version, mode });
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
      .select("name, description, draft_definition")
      .eq("id", flowId)
      .single();
    if (error) throw new Error(error.message);
    const { data, error: insertError } = await supabase
      .from("flows")
      .insert({
        name: `${flow.name} (copy)`.slice(0, 120),
        description: flow.description,
        draft_definition: flow.draft_definition,
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
      .select("id, version, definition")
      .eq("id", versionId)
      .eq("flow_id", flowId)
      .single();
    if (error) throw new Error(error.message);
    const { error: updateError } = await supabase
      .from("flows")
      .update({
        published_version_id: v.id,
        draft_definition: v.definition,
        draft_updated_at: new Date().toISOString(),
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
