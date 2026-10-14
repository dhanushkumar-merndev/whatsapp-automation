import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReplyBox } from "@/components/conversations/reply-box";
import { StatusControls } from "@/components/conversations/status-controls";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings/server";
import { isWindowOpen, windowExpiresAt } from "@/lib/engine/window";
import { fmtDate, fmtPhone } from "@/lib/format";
import type { OutboundMessage } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversation" };

function OutboundExtras({ payload }: { payload: unknown }) {
  const m = payload as OutboundMessage | null;
  if (!m || (m.kind !== "buttons" && m.kind !== "list")) return null;
  const opts = m.kind === "buttons" ? m.buttons : m.rows;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {opts.map((o) => (
        <span key={o.id} className="rounded-full border border-background/30 px-2 py-0.5 text-[11px] opacity-90">
          {o.title}
        </span>
      ))}
    </div>
  );
}

export default async function ConversationPage({ params }: PageProps<"/conversations/[id]">) {
  await requirePageSession("staff");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const settings = await loadSettings();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, status, last_inbound_at, is_test, handoff_reason, handoff_at, contacts(id, wa_id, name, profile_name, business_name, opted_out, cooldown_until, first_seen_at)")
    .eq("id", id)
    .maybeSingle();
  if (!conv) notFound();
  const contact = (Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts) as {
    id: string;
    wa_id: string;
    name: string | null;
    profile_name: string | null;
    business_name: string | null;
    opted_out: boolean;
    cooldown_until: string | null;
    first_seen_at: string;
  };

  const [{ data: messages }, { data: executions }, { data: leads }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, direction, type, body, payload, status, processing_status, processing_note, created_at, sent_by, error")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase
      .from("flow_executions")
      .select("id, status, started_at, current_node_id, error, flows(name)")
      .eq("conversation_id", id)
      .order("started_at", { ascending: false })
      .limit(5),
    supabase.from("leads").select("id, name, service, status").eq("conversation_id", id).order("created_at", { ascending: false }),
  ]);

  const open = isWindowOpen(conv.last_inbound_at, new Date(), settings);
  const expires = windowExpiresAt(conv.last_inbound_at, settings);
  const expiresLeft = expires ? formatDistanceToNowStrict(expires) : "";
  const expiresLabel = expires ? `closes in ${expiresLeft}` : "";

  return (
    // Desktop: the page fills the viewport; messages scroll inside the chat card and the reply box stays at the bottom.
    <div className="flex flex-col lg:h-[calc(100dvh-4.25rem)]">
      <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2 w-fit">
        <Link href="/conversations">
          <ArrowLeft /> Conversations
        </Link>
      </Button>
      <PageHeader
        className="mb-4"
        title={contact.name ?? contact.profile_name ?? fmtPhone(contact.wa_id)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {fmtPhone(contact.wa_id)}
            <StatusBadge status={conv.status} />
            {open ? <StatusBadge status={`window open · ${expiresLeft} left`} tone="green" /> : <StatusBadge status="window closed" tone="gray" />}
            {conv.is_test && <StatusBadge status="test number" tone="violet" />}
            {contact.opted_out && <StatusBadge status="opted out" tone="red" />}
          </span>
        }
        actions={<StatusControls conversationId={conv.id} status={conv.status} />}
      />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="min-h-0 flex-1 py-0">
            {/* column-reverse keeps the scroll pinned to the newest message on load */}
            <div className="flex h-full max-h-[65dvh] flex-col-reverse overflow-y-auto p-5 lg:max-h-none">
              <div className="space-y-2">
                {(messages ?? []).map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "inbound" ? "justify-start" : "justify-end")}>
                    <div className="max-w-[min(78%,760px)]">
                      <div
                        className={cn(
                          "rounded-3xl px-4 py-2 text-sm whitespace-pre-wrap",
                          m.direction === "inbound" ? "bg-muted" : "bg-foreground text-background",
                          m.status === "failed" && "ring-2 ring-destructive/40",
                        )}
                      >
                        {m.body ?? <span className="italic opacity-70">[{m.type}]</span>}
                        {m.direction === "outbound" && <OutboundExtras payload={m.payload} />}
                      </div>
                      <div className={cn("mt-0.5 px-2 text-[10px] text-muted-foreground", m.direction === "outbound" && "text-right")}>
                        {fmtDate(m.created_at, "d MMM, HH:mm")}
                        {m.direction === "outbound" && ` · ${m.sent_by ? "team" : "bot"} · ${m.status}`}
                        {m.direction === "inbound" && m.processing_note && ` · ${m.processing_note.replace(/_/g, " ")}`}
                      </div>
                    </div>
                  </div>
                ))}
                {!messages?.length && <p className="text-sm text-muted-foreground">No messages.</p>}
              </div>
            </div>
          </Card>
          <div className="shrink-0">
            <ReplyBox conversationId={conv.id} windowOpen={open && !contact.opted_out} optedOut={contact.opted_out} expiresLabel={expiresLabel} />
          </div>
        </div>
        <div className="min-h-0 space-y-4 lg:overflow-y-auto lg:pr-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">WhatsApp name:</span> {contact.profile_name ?? "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Business:</span> {contact.business_name ?? "—"}
              </div>
              <div>
                <span className="text-muted-foreground">First message:</span> {fmtDate(contact.first_seen_at)}
              </div>
              <div>
                <span className="text-muted-foreground">Last message:</span> {fmtDate(conv.last_inbound_at)}
              </div>
              {conv.status === "handoff" && conv.handoff_reason && (
                <div className="rounded-xl bg-warning/10 p-2 text-xs text-warning">Handoff: {conv.handoff_reason}</div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Automation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!executions?.length && <p className="text-sm text-muted-foreground">No flows have run.</p>}
              {executions?.map((e) => {
                const f = (Array.isArray(e.flows) ? e.flows[0] : e.flows) as { name: string } | null;
                return (
                  <Link key={e.id} href={`/logs?execution=${e.id}`} className="block rounded-xl border p-2.5 text-sm hover:bg-muted/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{f?.name ?? "Flow"}</span>
                      <StatusBadge status={e.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">{fmtDate(e.started_at)}</div>
                    {e.error && <div className="mt-1 text-xs text-destructive">{e.error}</div>}
                  </Link>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Leads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!leads?.length && <p className="text-sm text-muted-foreground">No lead captured yet.</p>}
              {leads?.map((l) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="flex items-center justify-between rounded-xl border p-2.5 text-sm hover:bg-muted/40">
                  <span className="truncate">{l.service ?? l.name ?? "Lead"}</span>
                  <StatusBadge status={l.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
