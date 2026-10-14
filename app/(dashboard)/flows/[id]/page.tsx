import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FlowEditorClient as FlowEditor } from "@/components/builder/flow-editor-client";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings/server";
import { defaultAssumptions, loadPlanContext } from "@/lib/estimator/plan-context";
import { flowDefinitionSchema } from "@/lib/engine/schema";
import type { EstimateReport } from "@/lib/estimator/estimate";

export const metadata: Metadata = { title: "Flow Builder" };

export default async function FlowEditorPage({ params }: PageProps<"/flows/[id]">) {
  await requirePageSession("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();

  const [{ data: flow }, { data: versions }, { data: media }, { data: crm }, settings] = await Promise.all([
    supabase
      .from("flows")
      .select("id, name, description, status, priority, draft_definition, draft_updated_at, published_version_id")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("flow_versions")
      .select("id, version, note, created_at, estimate_report, published_by, profiles:published_by(full_name, email)")
      .eq("flow_id", id)
      .order("version", { ascending: false }),
    supabase
      .from("media_assets")
      .select("id, name, kind")
      .eq("status", "ready")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("crm_integrations").select("id, name, enabled").order("created_at"),
    loadSettings(),
  ]);
  if (!flow) notFound();

  const plan = await loadPlanContext(settings, flow.id);
  const parsed = flowDefinitionSchema.safeParse(flow.draft_definition);
  const definition = parsed.success ? parsed.data : { nodes: [], edges: [] };
  const live = versions?.find((v) => v.id === flow.published_version_id);

  return (
    <FlowEditor
      flow={{
        id: flow.id,
        name: flow.name,
        description: flow.description,
        status: flow.status,
        priority: flow.priority,
        draftDefinition: definition,
        draftUpdatedAt: flow.draft_updated_at,
        publishedVersionId: flow.published_version_id,
        liveVersion: live?.version ?? null,
      }}
      versions={(versions ?? []).map((v) => {
        const p = (Array.isArray(v.profiles) ? v.profiles[0] : v.profiles) as { full_name: string | null; email: string } | null;
        return {
          id: v.id,
          version: v.version,
          note: v.note,
          createdAt: v.created_at,
          publishedBy: p?.full_name ?? p?.email ?? null,
          level: (v.estimate_report as EstimateReport | null)?.overallLevel ?? null,
        };
      })}
      media={(media ?? []).map((m) => ({ id: m.id, name: m.name, kind: m.kind }))}
      crm={(crm ?? []).map((c) => ({ id: c.id, name: c.name, enabled: c.enabled }))}
      plan={plan}
      defaultAssumptions={defaultAssumptions(settings)}
      settings={settings}
    />
  );
}
