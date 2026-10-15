import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { SourceBadge, type DataSource } from "@/components/common/source-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { startOfUtcDay, startOfUtcMonth } from "@/lib/server/metrics";
import { fetchUpstashRedisStats } from "@/lib/usage/providers";
import { fmtBytes, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Usage" };

/** Rough Redis commands per inbound message (rate-limit check). Used only when Upstash stats are not connected. */
const REDIS_COMMANDS_PER_MESSAGE = 4;

function Meter(props: { label: string; used: number; limit?: number | null; unit?: "count" | "bytes"; source: DataSource; sub?: string; note?: string }) {
  const { label, used, limit = null, unit = "count", source, sub, note } = props;
  const fmt = (n: number) => (unit === "bytes" ? fmtBytes(n) : fmtNumber(n));
  const pct = limit ? used / limit : null;
  return (
    <div className="rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        <SourceBadge source={source} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{fmt(used)}</div>
      <div className="text-xs text-muted-foreground">
        {limit ? `of ${fmt(limit)} free · ${(pct! * 100).toFixed(pct! < 0.1 ? 1 : 0)}%` : (sub ?? " ")}
      </div>
      {limit ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", pct! >= 1 ? "bg-destructive" : pct! >= 0.8 ? "bg-warning" : "bg-foreground")}
            style={{ width: `${Math.min(100, Math.max(pct! * 100, 0.5))}%` }}
          />
        </div>
      ) : null}
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export default async function UsagePage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  const now = new Date();
  const dayStart = startOfUtcDay(now).toISOString();
  const monthStart = startOfUtcMonth(now).toISOString();
  const from30 = new Date(startOfUtcDay(now).getTime() - 29 * 86_400_000).toISOString();

  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const msgs = () => supabase.from("messages").select("id", { count: "exact", head: true }).eq("is_test", false);

  const [
    { data: limits },
    receivedToday,
    receivedMonth,
    sentToday,
    sentMonth,
    billableMonth,
    billableRows,
    jobsToday,
    jobsMonth,
    { data: jobs30 },
    runsMonth,
    leadsMonth,
    { data: storage },
    { data: series },
    redis,
  ] = await Promise.all([
    supabase.from("plan_limits").select("service, metric, limit_value").eq("active", true),
    count(msgs().eq("direction", "inbound").gte("created_at", dayStart)),
    count(msgs().eq("direction", "inbound").gte("created_at", monthStart)),
    count(msgs().eq("direction", "outbound").in("status", ["sent", "delivered", "read"]).gte("created_at", dayStart)),
    count(msgs().eq("direction", "outbound").in("status", ["sent", "delivered", "read"]).gte("created_at", monthStart)),
    count(msgs().eq("direction", "outbound").eq("pricing_billable", true).gte("created_at", monthStart)),
    supabase.from("messages").select("pricing_category").eq("pricing_billable", true).gte("created_at", monthStart).limit(5000),
    count(supabase.from("scheduled_jobs").select("id", { count: "exact", head: true }).gte("created_at", dayStart)),
    count(supabase.from("scheduled_jobs").select("id", { count: "exact", head: true }).gte("created_at", monthStart)),
    supabase.from("scheduled_jobs").select("created_at").gte("created_at", from30).limit(10000),
    count(supabase.from("flow_executions").select("id", { count: "exact", head: true }).eq("is_test", false).gte("started_at", monthStart)),
    count(supabase.from("leads").select("id", { count: "exact", head: true }).eq("is_test", false).gte("created_at", monthStart)),
    supabase.rpc("get_storage_usage"),
    supabase.rpc("dashboard_series", { p_from: from30, p_to: now.toISOString(), p_include_test: false }),
    fetchUpstashRedisStats(),
  ]);

  const limit = (service: string, metric: string) => {
    const v = limits?.find((l) => l.service === service && l.metric === metric)?.limit_value;
    return v === null || v === undefined ? null : Number(v);
  };
  const byCategory = new Map<string, number>();
  for (const r of billableRows.data ?? []) {
    const c = (r.pricing_category as string | null) ?? "other";
    byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
  }
  const jobsPerDay = new Map<string, number>();
  for (const j of jobs30 ?? []) {
    const d = String(j.created_at).slice(0, 10);
    jobsPerDay.set(d, (jobsPerDay.get(d) ?? 0) + 1);
  }
  const daily = ((series ?? []) as { day: string; inbound: number; outbound: number }[]).map((r) => ({
    day: r.day,
    received: Number(r.inbound),
    sent: Number(r.outbound),
    scheduled: jobsPerDay.get(r.day) ?? 0,
  }));
  const s = storage as { database_bytes: number; media_bytes: number; media_objects: number } | null;
  const month = monthStart.slice(0, 7);
  const redisMonth = redis
    ? { value: redis.dailyCommands.filter((d) => d.day.startsWith(month)).reduce((a, d) => a + d.count, 0), source: "provider" as const }
    : { value: receivedMonth * REDIS_COMMANDS_PER_MESSAGE, source: "estimate" as const };

  return (
    <>
      <PageHeader title="Usage" description="What the bot has used so far, from your own data. Test conversations are not counted. Days and months are in UTC." />

      <div className="space-y-6">
        <section>
          <h2 className="mb-2.5 text-sm font-medium text-muted-foreground">WhatsApp</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Meter label="Messages received today" used={receivedToday} source="measured" sub={`${fmtNumber(receivedMonth)} this month`} />
            <Meter label="Messages sent today" used={sentToday} source="measured" sub={`${fmtNumber(sentMonth)} this month`} />
            <Meter
              label="Billable messages this month"
              used={billableMonth}
              source="provider"
              sub={byCategory.size ? [...byCategory].map(([c, n]) => `${fmtNumber(n)} ${c}`).join(" · ") : "Replies within 24 hours are free"}
              note="Meta charges only template messages (marketing / utility / authentication) and replies outside the 24-hour window."
            />
            <Meter label="Workflow runs this month" used={runsMonth} source="measured" sub={`${fmtNumber(leadsMonth)} leads this month`} />
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 text-sm font-medium text-muted-foreground">Services</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Meter
              label="QStash today"
              used={jobsToday}
              limit={limit("qstash", "deliveries")}
              source="measured"
              note={`${fmtNumber(jobsMonth)} this month. Only long waits and CRM retries use QStash; short waits run inside the reply.`}
            />
            <Meter
              label="Redis this month"
              used={redisMonth.value}
              limit={limit("redis", "commands")}
              source={redisMonth.source}
              note={redis ? "Reported by Upstash." : `About ${REDIS_COMMANDS_PER_MESSAGE} commands per received message. Add the UPSTASH_MANAGEMENT_* variables for exact numbers.`}
            />
            <Meter label="Database size" used={Number(s?.database_bytes ?? 0)} unit="bytes" limit={limit("supabase", "database_bytes")} source="measured" />
            <Meter
              label="Media storage"
              used={Number(s?.media_bytes ?? 0)}
              unit="bytes"
              limit={limit("supabase", "storage_bytes")}
              source="measured"
              note={`${fmtNumber(Number(s?.media_objects ?? 0))} files`}
            />
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Last 30 days</CardTitle>
            <CardDescription>Messages received and sent, and steps scheduled through QStash, per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeSeriesChart
              data={daily}
              series={[
                { key: "received", label: "Received" },
                { key: "sent", label: "Sent" },
                { key: "scheduled", label: "QStash" },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
