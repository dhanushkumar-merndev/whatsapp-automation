import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadEditor } from "@/components/leads/lead-editor";
import { ReadonlyFlowClient } from "@/components/builder/readonly-flow-client";
import { requirePageSession } from "@/lib/auth/guard";
import { roleAllows } from "@/lib/auth/steps";
import { createClient } from "@/lib/supabase/server";
import { flowDefinitionSchema } from "@/lib/engine/schema";
import { fmtAgo, fmtDate, fmtPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Lead" };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm break-words whitespace-pre-wrap">{value || "—"}</div>
    </div>
  );
}

/** One stored answer: plain text, a choice, a date, a customer file or a location. */
function AnswerValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <>—</>;
  if (typeof value !== "object") return <>{String(value)}</>;
  const v = value as { kind?: string; title?: string; messageId?: string | null; mapUrl?: string; raw?: string };
  if (v.kind === "media" && v.messageId) {
    return (
      <a className="underline" href={`/api/inbound-media/${encodeURIComponent(v.messageId)}`} target="_blank" rel="noreferrer">
        {v.title ?? "Open file"}
      </a>
    );
  }
  if (v.kind === "location" && v.mapUrl) {
    return (
      <a className="underline" href={v.mapUrl} target="_blank" rel="noreferrer">
        {v.title}
      </a>
    );
  }
  return <>{v.title ?? v.raw ?? "—"}</>;
}

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const session = await requirePageSession("staff");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) notFound();

  const [{ data: execution }, { data: deliveries }, { data: staff }, { data: messages }, { data: flow }] = await Promise.all([
    lead.flow_execution_id
      ? supabase.from("flow_executions").select("id, status, current_node_id, context, flow_version_id, started_at, completed_at, error").eq("id", lead.flow_execution_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("crm_deliveries")
      .select("id, status, attempts, last_status_code, last_error, delivered_at, updated_at, crm_integrations(name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("status", "active"),
    supabase
      .from("messages")
      .select("id, direction, body, status, created_at")
      .eq("conversation_id", lead.conversation_id)
      .order("created_at", { ascending: false })
      .limit(12),
    lead.flow_id ? supabase.from("flows").select("name").eq("id", lead.flow_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  let definition = null;
  if (execution?.flow_version_id) {
    const { data: v } = await supabase.from("flow_versions").select("definition").eq("id", execution.flow_version_id).maybeSingle();
    const parsed = flowDefinitionSchema.safeParse(v?.definition);
    if (parsed.success) definition = parsed.data;
  }
  const ctx = (execution?.context ?? {}) as { path?: string[]; vars?: Record<string, unknown> };
  // Everything the customer answered in this enquiry (internal and message bookkeeping left out).
  const answers = Object.entries({ ...(ctx.vars ?? {}), ...((lead.answers as Record<string, unknown> | null) ?? {}) }).filter(
    ([k]) => !k.startsWith("__") && k !== "first_message" && k !== "last_message",
  );
  const active = execution && ["running", "waiting_input", "waiting_delay"].includes(execution.status);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/leads">
          <ArrowLeft /> Leads
        </Link>
      </Button>
      <PageHeader
        title={lead.name ?? fmtPhone(lead.phone)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={lead.status} />
            <StatusBadge status={lead.crm_sync_status} />
            {lead.is_test && <StatusBadge status="test" tone="violet" />}
            <span>Created {fmtDate(lead.created_at)}</span>
          </span>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={`/conversations/${lead.conversation_id}`}>
              <MessagesSquare /> Open conversation
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Enquiry details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer name" value={lead.name} />
            <Field label="WhatsApp number" value={fmtPhone(lead.phone)} />
            <Field label="Business name" value={lead.business_name} />
            <Field label="Selected service" value={lead.service} />
            <Field label="Requirements" value={lead.requirements} />
            <Field label="Email" value={lead.email} />
            <Field label="Source" value="WhatsApp" />
            <Field label="Flow" value={flow?.name} />
            <Field label="Last activity" value={fmtAgo(lead.last_activity_at)} />
            <Field label="Last CRM sync" value={lead.crm_last_synced_at ? fmtDate(lead.crm_last_synced_at) : null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Manage</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadEditor
              lead={{ id: lead.id, status: lead.status, assigned_to: lead.assigned_to, notes: lead.notes, crm_sync_status: lead.crm_sync_status }}
              staff={(staff ?? []).map((s) => ({ id: s.id, name: s.full_name || s.email }))}
              canAdmin={roleAllows(session.role, "admin")}
            />
          </CardContent>
        </Card>
      </div>

      {answers.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-sm">All answers</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {answers.map(([k, v]) => (
              <Field key={k} label={k.replace(/_/g, " ")} value={<AnswerValue value={v} />} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            Progress through the automation
            {execution && <StatusBadge status={execution.status} />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {definition ? (
            <>
              <ReadonlyFlowClient definition={definition} visited={ctx.path ?? []} current={active ? execution!.current_node_id : null} />
              <p className="mt-2 text-xs text-muted-foreground">
                Highlighted steps were completed{active ? "; the ringed step is where the customer is now" : ""}.
                {execution?.error ? ` Note: ${execution.error}` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No automation history for this lead.</p>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">CRM deliveries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!deliveries?.length && <p className="text-sm text-muted-foreground">Not sent to a CRM yet.</p>}
            {deliveries?.map((d) => {
              const integ = (Array.isArray(d.crm_integrations) ? d.crm_integrations[0] : d.crm_integrations) as { name: string } | null;
              return (
                <div key={d.id} className="rounded-xl border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{integ?.name ?? "CRM"}</span>
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.attempts} attempt(s){d.last_status_code ? ` · HTTP ${d.last_status_code}` : ""} · {fmtAgo(d.updated_at)}
                  </div>
                  {d.last_error && <div className="mt-1 text-xs text-destructive">{d.last_error}</div>}
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent messages</CardTitle>
            <Link href={`/conversations/${lead.conversation_id}`} className="text-xs text-muted-foreground hover:text-foreground">
              Open conversation →
            </Link>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {!messages?.length && <p className="text-sm text-muted-foreground">No messages yet.</p>}
            {[...(messages ?? [])].reverse().map((m) => (
              <div key={m.id} className={`flex ${m.direction === "inbound" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap ${m.direction === "inbound" ? "bg-muted" : "bg-foreground text-background"}`}>
                  {m.body ?? <span className="italic opacity-70">[redacted]</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
