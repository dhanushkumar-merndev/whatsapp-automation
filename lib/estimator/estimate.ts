import type { FlowDefinition } from "@/lib/engine/schema";
import { analyzeFlow, type FlowAnalysis, type PerCustomer } from "./analyze";

/**
 * Flow Usage Estimator. Pure and deterministic: the editor recalculates it on
 * every change, and the server recalculates it before publishing.
 */

export const CUSTOMER_PRESETS = [10, 20, 50, 100] as const;

export interface EstimatorAssumptions {
  customersPerDay: number;
  /** Share of customers who answer every question (0–1). */
  completionRate: number;
  /** Day-over-day growth of new customers (0.02 = +2%/day). */
  dailyGrowthRate: number;
  /** Expected invalid answers per validation step per customer. */
  validationRetriesPerQuestion: number;
  /** Share of QStash deliveries that need one retry (0–1). */
  qstashRetryRate: number;
  averageMediaSizeMb: number;
  newMediaAssetsPerMonth: number;
  dbKbPerConversation: number;
  /** Override the outgoing messages per customer derived from the flow. */
  outgoingPerCustomerOverride?: number | null;
  /** Override the scheduled (QStash) actions per customer derived from the flow. */
  scheduledPerCustomerOverride?: number | null;
}

export interface MetaRate {
  category: string;
  countryCode: string;
  unitPrice: number;
  currency: string;
  freeAllowanceMonthly: number | null;
  effectiveFrom: string;
  source: "seeded" | "manual" | "provider";
}

export interface PlanContext {
  qstashDailyLimit: number | null;
  qstashMaxRetries: number;
  redisMonthlyLimit: number | null;
  redisCommandsPerCheck: number;
  supabaseDbLimitBytes: number | null;
  supabaseStorageLimitBytes: number | null;
  currentDbBytes: number | null;
  currentStorageBytes: number | null;
  metaRate: MetaRate | null;
  /** Projected usage of OTHER active flows sharing the same allowances. */
  otherFlows: { qstashPerDay: number; redisPerMonth: number; whatsappPerDay: number; customersPerDay: number };
  crmMaxAttempts: number;
}

export type WarningLevel = "normal" | "info" | "high" | "critical" | "exceeded";

export interface QuotaUsage {
  key: "qstash_daily" | "redis_monthly" | "supabase_db" | "supabase_storage";
  label: string;
  period: "day" | "month" | "total";
  limit: number | null;
  projected: number;
  projectedWorst: number;
  /** Other active flows' share included in the projection. */
  sharedWithOtherFlows: number;
  pct: number | null;
  pctWorst: number | null;
  level: WarningLevel;
  levelWorst: WarningLevel;
  unit: "deliveries" | "commands" | "bytes";
}

export interface EstimateReport {
  generatedAt: string;
  flowName: string;
  assumptions: EstimatorAssumptions;
  analysis: Pick<FlowAnalysis, "questionCount" | "waitCount" | "sendNodeCount" | "hasCrm">;
  perCustomer: { typical: PerCustomer; worst: PerCustomer; derivedOutgoing: number; derivedScheduled: number };
  daily: { customers: number; whatsappReplies: number; qstashDeliveries: number; qstashWorst: number; inbound: number };
  peakDay: { customers: number; whatsappReplies: number; qstashDeliveries: number; qstashWorst: number };
  monthly: {
    customers: number;
    whatsappReplies: number;
    whatsappRepliesWorst: number;
    qstashDeliveries: number;
    qstashWorst: number;
    redisCommands: number;
    dbGrowthBytes: number;
    storageBytes: number;
  };
  meta: {
    deliveredReplies: number;
    billableMessages: number | null;
    estimatedCost: number | null;
    currency: string | null;
    rateSource: "manual" | "unavailable";
    note: string;
  };
  quotas: QuotaUsage[];
  capacity: {
    qstashCustomersPerDay: number | null;
    redisCustomersPerDay: number | null;
    maxCustomersPerDay: number | null;
    limitingResource: string | null;
  };
  overallLevel: WarningLevel;
  warnings: string[];
  recommendation: string;
}

const LEVEL_ORDER: WarningLevel[] = ["normal", "info", "high", "critical", "exceeded"];

export function warningLevel(fraction: number | null): WarningLevel {
  if (fraction === null || !Number.isFinite(fraction)) return "normal";
  if (fraction >= 1) return "exceeded";
  if (fraction >= 0.95) return "critical";
  if (fraction >= 0.85) return "high";
  if (fraction >= 0.7) return "info";
  return "normal";
}

export function maxLevel(levels: WarningLevel[]): WarningLevel {
  return levels.reduce((a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a), "normal" as WarningLevel);
}

export const LEVEL_LABEL: Record<WarningLevel, string> = {
  normal: "Normal",
  info: "Informational warning",
  high: "High usage warning",
  critical: "Critical warning",
  exceeded: "Projected allowance exceeded",
};

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const safeDiv = (a: number, b: number) => (b > 0 ? a / b : null);

/** Customers on each of the next 30 days with compound daily growth. */
export function customerSeries(perDay: number, growth: number, days = 30): number[] {
  return Array.from({ length: days }, (_, d) => Math.max(0, perDay * (1 + growth) ** d));
}

export function estimateFlow(input: {
  flowName: string;
  definition: FlowDefinition;
  assumptions: EstimatorAssumptions;
  plan: PlanContext;
  now?: Date;
}): EstimateReport {
  const { assumptions: a, plan } = input;
  const analysis = analyzeFlow(input.definition, {
    completionRate: a.completionRate,
    validationRetriesPerQuestion: a.validationRetriesPerQuestion,
    qstashMaxRetries: plan.qstashMaxRetries,
    crmMaxAttempts: plan.crmMaxAttempts,
  });

  const derivedOutgoing = analysis.typical.outgoing;
  const derivedScheduled = analysis.typical.scheduled;
  const outgoingPer = a.outgoingPerCustomerOverride ?? derivedOutgoing;
  const scheduledPer = a.scheduledPerCustomerOverride ?? derivedScheduled;
  const scheduledPerWithRetries = scheduledPer * (1 + Math.max(0, a.qstashRetryRate));
  const worstScheduledPer = Math.max(analysis.worst.scheduled, scheduledPer * (1 + plan.qstashMaxRetries));
  const worstOutgoingPer = Math.max(analysis.worst.outgoing, outgoingPer);
  const inboundPer = 1 + analysis.typical.inbound; // first message + answers

  const series = customerSeries(a.customersPerDay, a.dailyGrowthRate);
  const day1 = series[0];
  const peak = series[series.length - 1];
  const monthCustomers = series.reduce((s, x) => s + x, 0);

  const daily = {
    customers: round(day1),
    whatsappReplies: round(day1 * outgoingPer),
    qstashDeliveries: round(day1 * scheduledPerWithRetries),
    qstashWorst: round(day1 * worstScheduledPer),
    inbound: round(day1 * inboundPer),
  };
  const peakDay = {
    customers: round(peak),
    whatsappReplies: round(peak * outgoingPer),
    qstashDeliveries: round(peak * scheduledPerWithRetries),
    qstashWorst: round(peak * worstScheduledPer),
  };
  const redisPerCustomer = inboundPer * plan.redisCommandsPerCheck;
  const monthly = {
    customers: round(monthCustomers),
    whatsappReplies: round(monthCustomers * outgoingPer),
    whatsappRepliesWorst: round(monthCustomers * worstOutgoingPer),
    qstashDeliveries: round(monthCustomers * scheduledPerWithRetries),
    qstashWorst: round(monthCustomers * worstScheduledPer),
    redisCommands: round(monthCustomers * redisPerCustomer),
    dbGrowthBytes: Math.round(monthCustomers * a.dbKbPerConversation * 1024),
    storageBytes: Math.round(
      (plan.currentStorageBytes ?? 0) + a.newMediaAssetsPerMonth * a.averageMediaSizeMb * 1024 * 1024,
    ),
  };

  // Meta: replies inside the service window are "service" messages.
  const rate = plan.metaRate;
  const deliveredReplies = monthly.whatsappReplies;
  const billable = rate ? Math.max(0, deliveredReplies - (rate.freeAllowanceMonthly ?? 0)) : null;
  const meta = {
    deliveredReplies,
    billableMessages: rate ? (rate.unitPrice > 0 ? round(billable!) : 0) : null,
    estimatedCost: rate ? round((billable ?? 0) * rate.unitPrice, 2) : null,
    currency: rate?.currency ?? null,
    rateSource: (rate ? "manual" : "unavailable") as "manual" | "unavailable",
    note: rate
      ? `Manually configured ${rate.category} rate for ${rate.countryCode === "*" ? "all countries" : rate.countryCode} (effective ${rate.effectiveFrom}). Not live Meta billing data.`
      : "No Meta rate card is configured — charges cannot be estimated.",
  };

  // Quotas (each against its own period).
  const quotas: QuotaUsage[] = [];
  const pushQuota = (q: Omit<QuotaUsage, "pct" | "pctWorst" | "level" | "levelWorst">) => {
    const pct = q.limit ? q.projected / q.limit : null;
    const pctWorst = q.limit ? q.projectedWorst / q.limit : null;
    quotas.push({ ...q, pct, pctWorst, level: warningLevel(pct), levelWorst: warningLevel(pctWorst) });
  };
  pushQuota({
    key: "qstash_daily",
    label: "QStash deliveries",
    period: "day",
    limit: plan.qstashDailyLimit,
    projected: round(peakDay.qstashDeliveries + plan.otherFlows.qstashPerDay),
    projectedWorst: round(peakDay.qstashWorst + plan.otherFlows.qstashPerDay),
    sharedWithOtherFlows: plan.otherFlows.qstashPerDay,
    unit: "deliveries",
  });
  pushQuota({
    key: "redis_monthly",
    label: "Redis commands",
    period: "month",
    limit: plan.redisMonthlyLimit,
    projected: round(monthly.redisCommands + plan.otherFlows.redisPerMonth),
    projectedWorst: round(monthly.redisCommands * 1.5 + plan.otherFlows.redisPerMonth),
    sharedWithOtherFlows: plan.otherFlows.redisPerMonth,
    unit: "commands",
  });
  pushQuota({
    key: "supabase_db",
    label: "Supabase database (after 30 days)",
    period: "total",
    limit: plan.supabaseDbLimitBytes,
    projected: (plan.currentDbBytes ?? 0) + monthly.dbGrowthBytes,
    projectedWorst: (plan.currentDbBytes ?? 0) + monthly.dbGrowthBytes * 2,
    sharedWithOtherFlows: 0,
    unit: "bytes",
  });
  pushQuota({
    key: "supabase_storage",
    label: "Supabase file storage",
    period: "total",
    limit: plan.supabaseStorageLimitBytes,
    projected: monthly.storageBytes,
    projectedWorst: monthly.storageBytes,
    sharedWithOtherFlows: 0,
    unit: "bytes",
  });

  // Capacity: customers/day supported by what remains after other flows.
  const qstashPerCustomer = scheduledPerWithRetries;
  const qstashCap =
    plan.qstashDailyLimit === null || qstashPerCustomer <= 0
      ? null
      : Math.max(0, Math.floor((plan.qstashDailyLimit - plan.otherFlows.qstashPerDay) / qstashPerCustomer));
  const redisCap =
    plan.redisMonthlyLimit === null || redisPerCustomer <= 0
      ? null
      : Math.max(0, Math.floor((plan.redisMonthlyLimit - plan.otherFlows.redisPerMonth) / 30 / redisPerCustomer));
  const caps = [
    { name: "QStash daily deliveries", v: qstashCap },
    { name: "Redis monthly commands", v: redisCap },
  ].filter((c): c is { name: string; v: number } => c.v !== null);
  const limiting = caps.sort((x, y) => x.v - y.v)[0] ?? null;

  // Warnings ------------------------------------------------------------------
  const warnings: string[] = [];
  const qs = quotas[0];
  if (qs.limit !== null) {
    if (qs.level !== "normal") {
      warnings.push(
        `Your current flow is estimated to use ${fmt(qs.projected)} of ${fmt(qs.limit)} QStash deliveries per day. You may approach your free-tier limit.`,
      );
    }
    if (qs.level !== "exceeded" && qs.levelWorst === "exceeded") {
      warnings.push(
        "Your selected flow may exceed the available daily QStash capacity after retries. Consider reducing unnecessary delays or upgrading your plan.",
      );
    }
    if (qs.level === "exceeded") {
      warnings.push(
        `Projected QStash usage (${fmt(qs.projected)}/day) exceeds the configured daily allowance of ${fmt(qs.limit)}. Reduce Wait steps, lower volume, or upgrade the plan.`,
      );
    }
    if (monthly.qstashDeliveries > qs.limit && qs.level !== "exceeded") {
      warnings.push(
        `${fmt(monthly.qstashDeliveries)} QStash deliveries over 30 days is not a quota violation: the QStash allowance is applied per day (${fmt(qs.limit)}/day) and daily usage stays within it.`,
      );
    }
  } else {
    warnings.push("No QStash allowance is configured — daily delivery capacity cannot be checked.");
  }
  warnings.push(
    `With ${fmt(a.customersPerDay)} customers per day, your workflow is estimated to send ${fmt(monthly.whatsappReplies)} WhatsApp replies in 30 days. Check your configured Meta messaging allowance and projected charges.`,
  );
  for (const q of quotas.slice(1)) {
    if (q.level !== "normal") {
      warnings.push(`${q.label}: projected ${Math.round((q.pct ?? 0) * 100)}% of the configured allowance (${LEVEL_LABEL[q.level]}).`);
    }
  }
  if (input.definition.nodes.some((n) => n.type === "send_media" && !(n.data.config as { assetId?: string }).assetId)) {
    warnings.push("A media step has no file selected and will be skipped.");
  }

  const overallLevel = maxLevel(quotas.map((q) => q.level));
  const worstLevel = maxLevel(quotas.map((q) => q.levelWorst));
  const recommendation =
    overallLevel === "exceeded"
      ? "Do not publish at this volume without upgrading: projected usage exceeds a configured allowance."
      : overallLevel === "critical"
        ? "Publishing is possible but risky. Reduce scheduled delays or lower the expected volume, or enable the hard usage cap."
        : overallLevel === "high" || worstLevel === "exceeded"
          ? "Usage is high. Monitor Usage & Limits after publishing and consider enabling the hard usage cap."
          : overallLevel === "info"
            ? "Usage is moderate. You can publish; keep an eye on daily QStash usage."
            : "Usage is comfortably within the configured allowances. Safe to publish.";

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    flowName: input.flowName,
    assumptions: a,
    analysis: {
      questionCount: analysis.questionCount,
      waitCount: analysis.waitCount,
      sendNodeCount: analysis.sendNodeCount,
      hasCrm: analysis.hasCrm,
    },
    perCustomer: {
      typical: { ...analysis.typical, outgoing: outgoingPer, scheduled: scheduledPer },
      worst: { ...analysis.worst, outgoing: worstOutgoingPer, scheduled: worstScheduledPer },
      derivedOutgoing: round(derivedOutgoing, 2),
      derivedScheduled: round(derivedScheduled, 2),
    },
    daily,
    peakDay,
    monthly,
    meta,
    quotas,
    capacity: {
      qstashCustomersPerDay: qstashCap,
      redisCustomersPerDay: redisCap,
      maxCustomersPerDay: limiting?.v ?? null,
      limitingResource: limiting?.name ?? null,
    },
    overallLevel,
    warnings,
    recommendation,
  };
}

/** Compact snapshot stored on the flow so other flows can account for shared usage. */
export function estimateSnapshot(report: EstimateReport) {
  return {
    generatedAt: report.generatedAt,
    customersPerDay: report.assumptions.customersPerDay,
    qstashPerDay: report.peakDay.qstashDeliveries,
    whatsappPerDay: report.peakDay.whatsappReplies,
    redisPerMonth: report.monthly.redisCommands,
    overallLevel: report.overallLevel,
  };
}
export type EstimateSnapshot = ReturnType<typeof estimateSnapshot>;

export { safeDiv };
