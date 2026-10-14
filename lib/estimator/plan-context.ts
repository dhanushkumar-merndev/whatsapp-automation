import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/settings/schema";
import type { EstimatorAssumptions, MetaRate, PlanContext } from "./estimate";

interface PlanLimitRow {
  service: string;
  metric: string;
  period: string;
  limit_value: number | null;
  unit_price: number | null;
  currency: string | null;
  category: string | null;
  country_code: string | null;
  plan_name: string | null;
  effective_from: string;
  effective_to: string | null;
  source: "seeded" | "manual" | "provider";
  notes: string | null;
  active: boolean;
}

function currentRows(rows: PlanLimitRow[], today: string) {
  return rows.filter((r) => r.active && r.effective_from <= today && (!r.effective_to || r.effective_to >= today));
}

function pickLimit(rows: PlanLimitRow[], service: string, metric: string): number | null {
  const hit = rows
    .filter((r) => r.service === service && r.metric === metric && r.limit_value !== null)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  return hit ? Number(hit.limit_value) : null;
}

export function pickMetaRate(rows: PlanLimitRow[], countryCode: string): MetaRate | null {
  const candidates = rows
    .filter((r) => r.service === "meta_whatsapp" && r.category === "service" && r.unit_price !== null)
    .sort((a, b) => {
      const spec = (r: PlanLimitRow) => (r.country_code?.toUpperCase() === countryCode.toUpperCase() ? 0 : 1);
      return spec(a) - spec(b) || b.effective_from.localeCompare(a.effective_from);
    });
  const r = candidates[0];
  if (!r) return null;
  return {
    category: r.category ?? "service",
    countryCode: r.country_code ?? "*",
    unitPrice: Number(r.unit_price),
    currency: r.currency ?? "USD",
    freeAllowanceMonthly: r.limit_value === null ? null : Number(r.limit_value),
    effectiveFrom: r.effective_from,
    source: r.source,
  };
}

/**
 * Loads configured allowances, measured storage and other flows' projected
 * usage. `excludeFlowId` is the flow being estimated (its own previous
 * snapshot must not be counted as "other" usage).
 */
export async function loadPlanContext(settings: AppSettings, excludeFlowId?: string | null): Promise<PlanContext> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: limits }, { data: flows }, storage] = await Promise.all([
    admin.from("plan_limits").select("*"),
    admin.from("flows").select("id, status, estimate_snapshot").in("status", ["active", "testing"]),
    admin.rpc("get_storage_usage").then((r) => (r.error ? null : (r.data as { database_bytes: number; media_bytes: number }))),
  ]);
  const rows = currentRows((limits ?? []) as PlanLimitRow[], today);
  const others = (flows ?? []).filter((f) => f.id !== excludeFlowId && f.status === "active");
  const sum = (k: string) =>
    others.reduce((s, f) => s + Number((f.estimate_snapshot as Record<string, number> | null)?.[k] ?? 0), 0);

  return {
    qstashDailyLimit: pickLimit(rows, "qstash", "deliveries"),
    qstashMaxRetries: settings.usage.qstashRetries,
    redisMonthlyLimit: pickLimit(rows, "redis", "commands"),
    redisCommandsPerCheck: settings.usage.redisCommandsPerCheck,
    supabaseDbLimitBytes: pickLimit(rows, "supabase", "database_bytes"),
    supabaseStorageLimitBytes: pickLimit(rows, "supabase", "storage_bytes"),
    currentDbBytes: storage ? Number(storage.database_bytes) : null,
    currentStorageBytes: storage ? Number(storage.media_bytes) : null,
    metaRate: pickMetaRate(rows, settings.estimator.metaCountryCode),
    otherFlows: {
      qstashPerDay: sum("qstashPerDay"),
      redisPerMonth: sum("redisPerMonth"),
      whatsappPerDay: sum("whatsappPerDay"),
      customersPerDay: sum("customersPerDay"),
    },
    crmMaxAttempts: 6,
  };
}

export function defaultAssumptions(settings: AppSettings): EstimatorAssumptions {
  const e = settings.estimator;
  return {
    customersPerDay: e.customersPerDay,
    completionRate: e.completionRate,
    dailyGrowthRate: e.dailyGrowthRate,
    validationRetriesPerQuestion: e.validationRetriesPerQuestion,
    qstashRetryRate: e.qstashRetryRate,
    averageMediaSizeMb: e.averageMediaSizeMb,
    newMediaAssetsPerMonth: e.newMediaAssetsPerMonth,
    dbKbPerConversation: e.dbKbPerConversation,
    outgoingPerCustomerOverride: null,
    scheduledPerCustomerOverride: null,
  };
}

export type { PlanLimitRow };
