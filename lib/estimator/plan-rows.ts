import type { AppSettings } from "@/lib/settings/schema";
import type { EstimatorAssumptions, MetaRate, PlanContext } from "./estimate";

/** Pure helpers that turn plan_limits rows into an estimator PlanContext. */

export interface PlanLimitRow {
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

export function currentRows(rows: PlanLimitRow[], today: string) {
  return rows.filter((r) => r.active && r.effective_from <= today && (!r.effective_to || r.effective_to >= today));
}

export function pickLimit(rows: PlanLimitRow[], service: string, metric: string): number | null {
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

export function buildPlanContext(input: {
  settings: AppSettings;
  limits: PlanLimitRow[];
  flows: { id: string; status: string; estimate_snapshot: unknown }[];
  storage: { database_bytes: number; media_bytes: number } | null;
  excludeFlowId?: string | null;
  today?: string;
}): PlanContext {
  const rows = currentRows(input.limits, input.today ?? new Date().toISOString().slice(0, 10));
  const others = input.flows.filter((f) => f.id !== input.excludeFlowId && f.status === "active");
  const sum = (k: string) => others.reduce((s, f) => s + Number((f.estimate_snapshot as Record<string, number> | null)?.[k] ?? 0), 0);
  return {
    qstashDailyLimit: pickLimit(rows, "qstash", "deliveries"),
    qstashMaxRetries: input.settings.usage.qstashRetries,
    redisMonthlyLimit: pickLimit(rows, "redis", "commands"),
    redisCommandsPerCheck: input.settings.usage.redisCommandsPerCheck,
    supabaseDbLimitBytes: pickLimit(rows, "supabase", "database_bytes"),
    supabaseStorageLimitBytes: pickLimit(rows, "supabase", "storage_bytes"),
    currentDbBytes: input.storage ? Number(input.storage.database_bytes) : null,
    currentStorageBytes: input.storage ? Number(input.storage.media_bytes) : null,
    metaRate: pickMetaRate(rows, input.settings.estimator.metaCountryCode),
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
