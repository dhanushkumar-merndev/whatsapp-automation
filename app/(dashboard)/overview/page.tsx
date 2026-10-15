import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  Inbox,
  MessageCircle,
  MessagesSquare,
  Send,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Webhook,
  Workflow,
  Receipt,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { RangeFilter, RANGES, parseRange } from "@/components/common/range-filter";
import { StatusBadge } from "@/components/common/status-badge";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { overviewMetrics } from "@/lib/server/metrics";
import { fmtAgo, fmtNumber, fmtPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: PageProps<"/overview">) {
  const session = await requirePageSession("staff");
  const range = parseRange((await searchParams).range);
  const days = RANGES[range];
  const supabase = await createClient();
  const [m, { data: recentLeads }, { data: alerts }] = await Promise.all([
    overviewMetrics(supabase, days),
    supabase
      .from("leads")
      .select("id, name, phone, service, status, crm_sync_status, created_at")
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("notifications")
      .select("id, severity, title, link, created_at")
      .is("read_at", null)
      .in("severity", ["warning", "critical"])
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome back${session.fullName ? `, ${session.fullName}` : ""}`}
        description="Live figures from your WhatsApp automation. Test conversations are excluded."
        actions={<RangeFilter value={range} basePath="/overview" />}
      />

      {(m.needsReply > 0 || (alerts?.length ?? 0) > 0) && (
        <section className="mb-6">
          <h2 className="mb-2.5 text-sm font-medium text-muted-foreground">Needs attention</h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {m.needsReply > 0 && (
              <Link href="/conversations?view=handoff" className="flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-3.5 text-sm hover:bg-warning/10">
                <span className="size-2 shrink-0 rounded-full bg-warning" />
                <span>
                  <span className="font-medium">{m.needsReply}</span> conversation{m.needsReply === 1 ? "" : "s"} waiting for your team
                </span>
              </Link>
            )}
            {(alerts ?? []).map((a) => (
              <Link key={a.id} href={a.link ?? "#"} className="flex items-start gap-3 rounded-2xl border p-3.5 text-sm hover:bg-muted/40">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${a.severity === "critical" ? "bg-destructive" : "bg-warning"}`} />
                <span className="min-w-0">
                  <span className="line-clamp-1">{a.title}</span>
                  <span className="text-xs text-muted-foreground">{fmtAgo(a.created_at)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-6">
        <section>
          <h2 className="mb-2.5 text-sm font-medium text-muted-foreground">Customers & leads</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total customers" value={fmtNumber(m.customers)} icon={Users} href="/conversations" />
            <StatCard label="New leads today" value={fmtNumber(m.newLeadsToday)} icon={UserPlus} href="/leads?view=new" />
            <StatCard label="Qualified leads" value={fmtNumber(m.qualified)} sub={`last ${days} days`} icon={UserCheck} href="/leads?view=qualified" />
            <StatCard label="Active conversations" value={fmtNumber(m.activeConversations)} sub="within the 24h window" icon={MessagesSquare} href="/conversations?view=open" />
          </div>
        </section>
        <section>
          <h2 className="mb-2.5 text-sm font-medium text-muted-foreground">Messages & automation</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Messages received" value={fmtNumber(m.received)} sub={`last ${days} days`} icon={Inbox} />
            <StatCard label="Messages sent" value={fmtNumber(m.sent)} sub={`last ${days} days`} icon={Send} />
            <StatCard label="Live workflows" value={fmtNumber(m.flowsActive)} sub={`${fmtNumber(m.inProgress)} conversations in progress`} icon={Workflow} href="/flows" />
            <StatCard
              label="Automation errors"
              value={fmtNumber(m.errors)}
              sub={`last ${days} days`}
              icon={AlertTriangle}
              href="/logs?status=failed"
              tone={m.errors > 0 ? "critical" : "default"}
            />
          </div>
        </section>
        <section>
          <h2 className="mb-2.5 text-sm font-medium text-muted-foreground">Bookings & integrations</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="CRM sync"
              value={`${fmtNumber(m.crm.synced)} synced`}
              sub={`${fmtNumber(m.crm.pending)} pending · ${fmtNumber(m.crm.failed)} failed`}
              icon={Webhook}
              href="/leads?view=crm_failed"
              tone={m.crm.failed > 0 ? "warning" : "default"}
            />
            <StatCard label="Upcoming bookings" value={fmtNumber(m.upcomingBookings)} icon={CalendarDays} href="/bookings" />
            <StatCard label="Billable WhatsApp messages" value={fmtNumber(m.billable)} sub="this month, as reported by Meta" icon={Receipt} />
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageCircle className="size-4" /> Conversation activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TimeSeriesChart
              data={m.series}
              series={[
                { key: "inbound", label: "Received" },
                { key: "outbound", label: "Sent" },
              ]}
              unit="messages"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4" /> New leads per day
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TimeSeriesChart data={m.series} series={[{ key: "leads", label: "Leads" }]} kind="bar" unit="leads" />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent leads</CardTitle>
            <Link href="/leads" className="text-xs text-muted-foreground hover:text-foreground">
              View all →
            </Link>
          </CardHeader>
          <CardContent className="px-0">
            {!recentLeads?.length ? (
              <p className="px-5 text-sm text-muted-foreground">No leads yet. They appear here as soon as customers answer your flow.</p>
            ) : (
              <ul className="divide-y">
                {recentLeads.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/40">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{l.name ?? fmtPhone(l.phone)}</div>
                        <div className="truncate text-xs text-muted-foreground">{l.service ?? "Service not selected yet"}</div>
                      </div>
                      <StatusBadge status={l.status} />
                      <StatusBadge status={l.crm_sync_status} />
                      <span className="w-20 text-right text-xs text-muted-foreground">{fmtAgo(l.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
