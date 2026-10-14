import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SourceBadge, type DataSource } from "@/components/common/source-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PlanLimitDialog, DeletePlanLimitButton, type PlanLimitItem } from "@/components/usage/plan-limits-editor";
import { HardCapForm } from "@/components/usage/hard-cap-form";
import { LevelPill } from "@/components/builder/usage-report";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings/server";
import { dailyUsageSeries, startOfUtcDay, startOfUtcMonth, sumUsage } from "@/lib/server/metrics";
import { pickMetaRate, type PlanLimitRow } from "@/lib/estimator/plan-rows";
import { warningLevel, type EstimateSnapshot } from "@/lib/estimator/estimate";
import { fmtBytes, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Usage & Limits" };

function Meter({ label, used, limit, unit, source, reset, note }: { label: string; used: number; limit: number | null; unit: "count" | "bytes"; source: DataSource; reset?: string; note?: string }) {
  const pct = limit ? used / limit : null;
  const level = warningLevel(pct);
  const fmt = (n: number) => (unit === "bytes" ? fmtBytes(n) : fmtNumber(n));
  return (
    <div className="rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        <SourceBadge source={source} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{fmt(used)}</div>
      <div className="text-xs text-muted-foreground">{limit !== null ? `of ${fmt(limit)}${pct !== null ? ` · ${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%` : ""}` : "no allowance configured"}</div>
      {limit !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", level === "exceeded" ? "bg-red-600" : level === "critical" ? "bg-orange-600" : level === "high" ? "bg-amber-500" : "bg-foreground")}
            style={{ width: `${Math.min(100, Math.max((pct ?? 0) * 100, 0.5))}%` }}
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {pct !== null && level !== "normal" && <LevelPill level={level} />}
        {reset && <span className="text-[11px] text-muted-foreground">Resets {reset}</span>}
      </div>
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export default async function UsagePage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  const settings = await loadSettings();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = startOfUtcMonth(now).toISOString().slice(0, 10);
  const nextUtcMidnight = new Date(startOfUtcDay(now).getTime() + 86_400_000);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [
    { data: limitRows },
    qstashToday,
    qstashRetriesToday,
    qstashMonth,
    redisMonth,
    sentToday,
    sentMonth,
    receivedMonth,
    crmMonth,
    storage,
    { count: billable },
    { count: failedJobs },
    { data: flows },
    { data: perFlow },
    qstashSeries,
    sentSeries,
  ] = await Promise.all([
    supabase.from("plan_limits").select("*").order("service").order("effective_from", { ascending: false }),
    sumUsage(supabase, "qstash", "deliveries", today, today),
    sumUsage(supabase, "qstash", "retries", today, today),
    sumUsage(supabase, "qstash", "deliveries", monthStart),
    sumUsage(supabase, "redis", "commands", monthStart),
    sumUsage(supabase, "whatsapp", "messages_sent", today, today),
    sumUsage(supabase, "whatsapp", "messages_sent", monthStart),
    sumUsage(supabase, "whatsapp", "messages_received", monthStart),
    sumUsage(supabase, "crm", "deliveries", monthStart),
    supabase.rpc("get_storage_usage"),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("direction", "outbound").eq("pricing_billable", true).gte("created_at", startOfUtcMonth(now).toISOString()),
    supabase.from("scheduled_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", new Date(now.getTime() - 30 * 86_400_000).toISOString()),
    supabase.from("flows").select("id, name, status, estimate_snapshot").in("status", ["active", "testing"]),
    supabase.from("usage_records").select("flow_id, service, metric, quantity").not("flow_id", "is", null).gte("period_start", monthStart).eq("is_test", false),
    dailyUsageSeries(supabase, "qstash", "deliveries", 30, "local_measured"),
    dailyUsageSeries(supabase, "whatsapp", "messages_sent", 30, "local_measured"),
  ]);

  const rows = (limitRows ?? []) as (PlanLimitRow & { id: string; phone_number_id: string | null; unit: string | null })[];
  const active = rows.filter((r) => r.active);
  const limit = (service: string, metric: string) => {
    const r = active.find((x) => x.service === service && x.metric === metric && x.limit_value !== null);
    return r ? Number(r.limit_value) : null;
  };
  const rate = pickMetaRate(active, settings.estimator.metaCountryCode);
  const st = (storage.data ?? null) as { database_bytes: number; media_bytes: number } | null;
  const forecastQstash = (flows ?? []).filter((f) => f.status === "active").reduce((s, f) => s + Number((f.estimate_snapshot as EstimateSnapshot | null)?.qstashPerDay ?? 0), 0);
  const flowName = new Map((flows ?? []).map((f) => [f.id, f.name]));
  const perFlowAgg = new Map<string, { qstash: number; whatsapp: number }>();
  for (const r of perFlow ?? []) {
    const a = perFlowAgg.get(r.flow_id!) ?? { qstash: 0, whatsapp: 0 };
    if (r.service === "qstash") a.qstash += Number(r.quantity);
    if (r.service === "whatsapp") a.whatsapp += Number(r.quantity);
    perFlowAgg.set(r.flow_id!, a);
  }
  const hobbyInProd = settings.hosting.environment === "production" && settings.hosting.plan === "hobby";
  const srcOf = (s: { source: string }): DataSource => (s.source === "unavailable" ? "local_measured" : (s.source as DataSource));

  return (
    <>
      <PageHeader
        title="Usage & Limits"
        description="Actual usage against your configured allowances. Every figure is labelled with where it comes from — local counts and estimates are never official provider billing."
      />

      {hobbyInProd && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Settings say this is a <b>production</b> deployment on the <b>Vercel Hobby</b> plan. Hobby is for personal, non-commercial use — use Vercel Pro
            for commercial production. (Settings → General → Hosting)
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Meter
          label="QStash deliveries today"
          used={qstashToday.value}
          limit={limit("qstash", "deliveries")}
          unit="count"
          source={srcOf(qstashToday)}
          reset={`${fmtDate(nextUtcMidnight.toISOString(), "d MMM HH:mm")} (00:00 UTC)`}
          note={`${fmtNumber(qstashRetriesToday.value)} retries today · forecast ${fmtNumber(forecastQstash, 1)}/day from active flows · ${fmtNumber(qstashMonth.value)} this month`}
        />
        <Meter
          label="Redis commands this month"
          used={redisMonth.value}
          limit={limit("redis", "commands")}
          unit="count"
          source={srcOf(redisMonth)}
          reset={`${fmtDate(nextMonth.toISOString(), "d MMM")} (approx. — Upstash bills per account cycle)`}
          note={redisMonth.source === "estimate" ? "Estimated from rate-limit checks. Configure the Upstash Developer API for provider figures." : undefined}
        />
        <Meter label="Supabase database" used={Number(st?.database_bytes ?? 0)} limit={limit("supabase", "database_bytes")} unit="bytes" source="measured" />
        <Meter label="Supabase file storage" used={Number(st?.media_bytes ?? 0)} limit={limit("supabase", "storage_bytes")} unit="bytes" source="measured" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Meter label="WhatsApp replies sent today" used={sentToday.value} limit={null} unit="count" source={srcOf(sentToday)} note={`${fmtNumber(sentMonth.value)} this month · ${fmtNumber(receivedMonth.value)} received`} />
        <Meter label="Billable messages this month" used={billable ?? 0} limit={null} unit="count" source="provider" note="From Meta delivery receipts (pricing.billable)." />
        <div className="rounded-2xl border p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium">Est. WhatsApp cost this month</div>
            <SourceBadge source={rate ? "manual" : "unavailable"} />
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{rate ? fmtMoney((billable ?? 0) * rate.unitPrice, rate.currency) : "Unavailable"}</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {rate ? `Billable count × manually configured ${rate.category} rate (${rate.countryCode}, from ${rate.effectiveFrom}).` : "Add a Meta rate card below to estimate charges."}
          </p>
        </div>
        <Meter label="CRM deliveries this month" used={crmMonth.value} limit={null} unit="count" source={srcOf(crmMonth)} note={`${fmtNumber(failedJobs ?? 0)} failed scheduled jobs in 30 days`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">QStash deliveries per day</CardTitle>
            <CardDescription>Local count of published jobs plus retries. The allowance applies per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeSeriesChart
              data={qstashSeries.map((d) => ({ day: d.day, value: d.value }))}
              series={[{ key: "value", label: "Deliveries" }]}
              kind="bar"
              reference={limit("qstash", "deliveries") ? { value: limit("qstash", "deliveries")!, label: "Daily allowance" } : null}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">WhatsApp replies sent per day</CardTitle>
            <CardDescription>Local count of messages accepted by the Cloud API.</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeSeriesChart data={sentSeries.map((d) => ({ day: d.day, value: d.value }))} series={[{ key: "value", label: "Replies" }]} kind="bar" />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 py-0">
        <CardHeader className="pt-5">
          <CardTitle className="text-sm">Per-flow consumption (this month)</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flow</TableHead>
              <TableHead className="text-right">WhatsApp replies</TableHead>
              <TableHead className="text-right">QStash deliveries</TableHead>
              <TableHead className="text-right">Projected QStash / day</TableHead>
              <TableHead>Projected level</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(flows ?? []).map((f) => {
              const a = perFlowAgg.get(f.id) ?? { qstash: 0, whatsapp: 0 };
              const snap = f.estimate_snapshot as EstimateSnapshot | null;
              return (
                <TableRow key={f.id}>
                  <TableCell>{flowName.get(f.id)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNumber(a.whatsapp)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNumber(a.qstash)}</TableCell>
                  <TableCell className="text-right tabular-nums">{snap ? fmtNumber(snap.qstashPerDay, 1) : "—"}</TableCell>
                  <TableCell>{snap ? <LevelPill level={snap.overallLevel} /> : "—"}</TableCell>
                </TableRow>
              );
            })}
            {!flows?.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  No active flows.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="py-0 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pt-5">
            <div>
              <CardTitle className="text-sm">Configured allowances & rate cards</CardTitle>
              <CardDescription>Seeded from published plan pages — verify and edit for your accounts.</CardDescription>
            </div>
            <PlanLimitDialog />
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Metric</TableHead>
                <TableHead>Allowance</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Source</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={cn(!r.active && "opacity-50")}>
                  <TableCell className="text-sm">{r.service}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.metric}
                    {r.category ? ` · ${r.category}` : ""}
                    {r.country_code ? ` · ${r.country_code}` : ""}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {r.limit_value === null ? "—" : r.unit === "bytes" ? fmtBytes(Number(r.limit_value)) : fmtNumber(Number(r.limit_value))} / {r.period}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{r.unit_price === null ? "—" : `${r.unit_price} ${r.currency ?? ""}`}</TableCell>
                  <TableCell className="text-sm">{r.plan_name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.effective_from}</TableCell>
                  <TableCell>
                    <SourceBadge source={r.source === "provider" ? "provider" : "manual"} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <PlanLimitDialog item={r as unknown as PlanLimitItem} />
                    <DeletePlanLimitButton id={r.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Capacity protection</CardTitle>
          </CardHeader>
          <CardContent>
            <HardCapForm
              initial={{
                hardCapEnabled: settings.usage.hardCapEnabled,
                qstashDailyBudget: settings.usage.qstashDailyBudget,
                redisCommandsPerCheck: settings.usage.redisCommandsPerCheck,
                qstashRetries: settings.usage.qstashRetries,
              }}
            />
            <div className="mt-5 rounded-2xl bg-muted/60 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Hosting</div>
              Vercel {settings.hosting.plan} · {settings.hosting.environment}. Hobby cron jobs run once per day; commercial production needs Pro.
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
