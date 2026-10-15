import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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

export async function overviewMetrics(db: SupabaseClient, rangeDays: number) {
  const now = new Date();
  const todayStart = startOfUtcDay(now).toISOString();
  const from = new Date(startOfUtcDay(now).getTime() - (rangeDays - 1) * 86_400_000);
  const fromIso = from.toISOString();
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
    db.rpc("dashboard_series", { p_from: fromIso, p_to: now.toISOString(), p_include_test: false }),
  ]);

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
    billable,
    series: ((series.data ?? []) as { day: string; inbound: number; outbound: number; leads: number; qualified: number }[]).map((r) => ({
      day: r.day,
      inbound: Number(r.inbound),
      outbound: Number(r.outbound),
      leads: Number(r.leads),
      qualified: Number(r.qualified),
    })),
  };
}
