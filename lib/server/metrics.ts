import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickMetaRate, type PlanLimitRow } from "@/lib/estimator/plan-rows";

export function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function hoursAgoIso(hours: number) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function startOfUtcMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count: c, error } = await q;
  if (error) throw new Error(error.message);
  return c ?? 0;
}

export interface UsageSum {
  value: number;
  source: "provider" | "local_measured" | "estimate" | "unavailable";
}

/** Sum a usage metric over a period, preferring provider-reported rows. */
export async function sumUsage(db: SupabaseClient, service: string, metric: string, fromDay: string, toDay?: string): Promise<UsageSum> {
  let q = db.from("usage_records").select("quantity, source").eq("service", service).eq("metric", metric).eq("is_test", false).gte("period_start", fromDay);
  if (toDay) q = q.lte("period_start", toDay);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  for (const source of ["provider", "local_measured", "estimate"] as const) {
    const subset = rows.filter((r) => r.source === source);
    if (subset.length) return { value: subset.reduce((s, r) => s + Number(r.quantity), 0), source };
  }
  return { value: 0, source: "unavailable" };
}

export async function dailyUsageSeries(db: SupabaseClient, service: string, metric: string, days: number, source?: string) {
  const from = new Date(startOfUtcDay().getTime() - (days - 1) * 86_400_000);
  let q = db
    .from("usage_records")
    .select("period_start, quantity, source")
    .eq("service", service)
    .eq("metric", metric)
    .eq("is_test", false)
    .gte("period_start", from.toISOString().slice(0, 10));
  if (source) q = q.eq("source", source);
  const { data } = await q;
  const byDay = new Map<string, number>();
  for (const r of data ?? []) byDay.set(r.period_start, (byDay.get(r.period_start) ?? 0) + Number(r.quantity));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { day, value: byDay.get(day) ?? 0 };
  });
}

export async function overviewMetrics(db: SupabaseClient, rangeDays: number) {
  const now = new Date();
  const todayStart = startOfUtcDay(now).toISOString();
  const from = new Date(startOfUtcDay(now).getTime() - (rangeDays - 1) * 86_400_000);
  const fromIso = from.toISOString();
  const monthDay = startOfUtcMonth(now).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const windowStart = new Date(now.getTime() - 24 * 3_600_000).toISOString();

  const [
    customers,
    newLeadsToday,
    qualified,
    received,
    sent,
    activeConversations,
    needsReply,
    flowsActive,
    inProgress,
    failedNodes,
    failedExecutions,
    crmPending,
    crmFailed,
    crmSynced,
    billable,
    qstashToday,
    redisMonth,
    limits,
    series,
  ] = await Promise.all([
    count(db.from("contacts").select("id", { count: "exact", head: true }).eq("is_test", false)),
    count(db.from("leads").select("id", { count: "exact", head: true }).eq("is_test", false).gte("created_at", todayStart)),
    count(db.from("leads").select("id", { count: "exact", head: true }).eq("is_test", false).eq("status", "qualified").gte("created_at", fromIso)),
    count(db.from("messages").select("id", { count: "exact", head: true }).eq("is_test", false).eq("direction", "inbound").gte("created_at", fromIso)),
    count(
      db.from("messages").select("id", { count: "exact", head: true }).eq("is_test", false).eq("direction", "outbound").in("status", ["sent", "delivered", "read"]).gte("created_at", fromIso),
    ),
    count(db.from("conversations").select("id", { count: "exact", head: true }).eq("is_test", false).gte("last_inbound_at", windowStart)),
    count(db.from("conversations").select("id", { count: "exact", head: true }).eq("status", "handoff")),
    count(db.from("flows").select("id", { count: "exact", head: true }).eq("status", "active")),
    count(db.from("flow_executions").select("id", { count: "exact", head: true }).in("status", ["running", "waiting_input", "waiting_delay"])),
    count(db.from("node_executions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", fromIso)),
    count(db.from("flow_executions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", fromIso)),
    count(db.from("leads").select("id", { count: "exact", head: true }).eq("is_test", false).eq("crm_sync_status", "pending")),
    count(db.from("leads").select("id", { count: "exact", head: true }).eq("is_test", false).eq("crm_sync_status", "failed")),
    count(db.from("leads").select("id", { count: "exact", head: true }).eq("is_test", false).eq("crm_sync_status", "synced")),
    count(
      db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "outbound").eq("pricing_billable", true).gte("created_at", startOfUtcMonth(now).toISOString()),
    ),
    sumUsage(db, "qstash", "deliveries", today, today),
    sumUsage(db, "redis", "commands", monthDay),
    db.from("plan_limits").select("*"),
    db.rpc("dashboard_series", { p_from: fromIso, p_to: now.toISOString(), p_include_test: false }),
  ]);

  const rows = (limits.data ?? []) as PlanLimitRow[];
  const rate = pickMetaRate(rows, "*");
  const qstashLimit = rows.find((r) => r.service === "qstash" && r.metric === "deliveries" && r.active)?.limit_value ?? null;
  const redisLimit = rows.find((r) => r.service === "redis" && r.metric === "commands" && r.active)?.limit_value ?? null;

  return {
    customers,
    newLeadsToday,
    qualified,
    received,
    sent,
    activeConversations,
    needsReply,
    flowsActive,
    inProgress,
    errors: failedNodes + failedExecutions,
    crm: { pending: crmPending, failed: crmFailed, synced: crmSynced },
    meta: { billable, rate, estimatedCost: rate ? billable * rate.unitPrice : null },
    qstashToday,
    qstashLimit: qstashLimit === null ? null : Number(qstashLimit),
    redisMonth,
    redisLimit: redisLimit === null ? null : Number(redisLimit),
    series: ((series.data ?? []) as { day: string; inbound: number; outbound: number; leads: number; qualified: number }[]).map((r) => ({
      day: r.day,
      inbound: Number(r.inbound),
      outbound: Number(r.outbound),
      leads: Number(r.leads),
      qualified: Number(r.qualified),
    })),
  };
}
