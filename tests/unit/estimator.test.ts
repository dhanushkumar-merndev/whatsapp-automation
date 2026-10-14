import { describe, expect, it } from "vitest";
import { estimateFlow, warningLevel, type EstimatorAssumptions, type PlanContext } from "@/lib/estimator/estimate";
import { analyzeFlow, FOLLOW_UP_SHARE } from "@/lib/estimator/analyze";
import { buildDefaultFlowDefinition } from "@/lib/flows/default-flow";
import type { FlowDefinition } from "@/lib/engine/schema";

const plan: PlanContext = {
  qstashDailyLimit: 1000,
  qstashMaxRetries: 3,
  redisMonthlyLimit: 500_000,
  redisCommandsPerCheck: 4,
  supabaseDbLimitBytes: 500 * 1024 * 1024,
  supabaseStorageLimitBytes: 1024 * 1024 * 1024,
  currentDbBytes: 20 * 1024 * 1024,
  currentStorageBytes: 5 * 1024 * 1024,
  metaRate: { category: "service", countryCode: "*", unitPrice: 0, currency: "USD", freeAllowanceMonthly: null, effectiveFrom: "2025-07-01", source: "seeded" },
  otherFlows: { qstashPerDay: 0, redisPerMonth: 0, whatsappPerDay: 0, customersPerDay: 0 },
  crmMaxAttempts: 6,
};

const base: EstimatorAssumptions = {
  customersPerDay: 20,
  completionRate: 1,
  dailyGrowthRate: 0,
  validationRetriesPerQuestion: 0,
  qstashRetryRate: 0,
  averageMediaSizeMb: 2,
  newMediaAssetsPerMonth: 0,
  dbKbPerConversation: 24,
};

const definition = buildDefaultFlowDefinition("00000000-0000-4000-8000-000000000001");

describe("Flow Usage Estimator", () => {
  it("reproduces the specification example (20 customers × 5 replies × 3 scheduled)", () => {
    const r = estimateFlow({
      flowName: "Example",
      definition,
      assumptions: { ...base, outgoingPerCustomerOverride: 5, scheduledPerCustomerOverride: 3 },
      plan,
    });
    expect(r.daily.whatsappReplies).toBe(100);
    expect(r.monthly.whatsappReplies).toBe(3000);
    expect(r.daily.qstashDeliveries).toBe(60);
    expect(r.monthly.qstashDeliveries).toBe(1800);
    const q = r.quotas.find((x) => x.key === "qstash_daily")!;
    expect(q.pct).toBeCloseTo(0.06, 5);
    expect(q.level).toBe("normal");
    // 1,800/month is explicitly explained as NOT a violation of the daily allowance.
    expect(r.warnings.some((w) => w.includes("not a quota violation"))).toBe(true);
    // Worst case is shown separately and includes retries.
    expect(r.peakDay.qstashWorst).toBeGreaterThan(r.peakDay.qstashDeliveries);
  });

  it("counts only real QStash deliveries — immediate steps cost nothing", () => {
    const a = analyzeFlow(definition, { completionRate: 1, validationRetriesPerQuestion: 0, qstashMaxRetries: 3, crmMaxAttempts: 6 });
    // The default flow has exactly one Wait node, skipped by follow-ups from customers with an open enquiry.
    expect(a.typical.scheduled).toBeCloseTo(1 - FOLLOW_UP_SHARE, 5);
    expect(a.waitCount).toBe(1);
    // Many more nodes than scheduled deliveries.
    expect(definition.nodes.length).toBeGreaterThan(10);
  });

  it("derives typical replies from the flow: welcome, brochure, questions and confirmation", () => {
    const a = analyzeFlow(definition, { completionRate: 1, validationRetriesPerQuestion: 0, qstashMaxRetries: 3, crmMaxAttempts: 6 });
    // New enquiry: welcome + brochure + (0.5 × welcome-back + 0.5 × ask name) + service + business + requirements + confirmation = 7.
    // Follow-up with an open enquiry: one "already received" notice.
    expect(a.typical.outgoing).toBeCloseTo((1 - FOLLOW_UP_SHARE) * 7 + FOLLOW_UP_SHARE * 1, 5);
    expect(a.worst.outgoing).toBeGreaterThan(a.typical.outgoing);
  });

  it("applies drop-off and expected validation retries", () => {
    const a = analyzeFlow(definition, { completionRate: 0.5, validationRetriesPerQuestion: 0.5, qstashMaxRetries: 3, crmMaxAttempts: 6 });
    const full = analyzeFlow(definition, { completionRate: 1, validationRetriesPerQuestion: 0, qstashMaxRetries: 3, crmMaxAttempts: 6 });
    expect(a.typical.outgoing).toBeLessThan(full.typical.outgoing + 2);
    expect(a.typical.crmDeliveries).toBeLessThan(full.typical.crmDeliveries);
  });

  it("recalculates when nodes change (adding a Wait adds a delivery)", () => {
    const more: FlowDefinition = structuredClone(definition);
    more.nodes.push({ id: "w2", type: "wait", position: { x: 0, y: 0 }, data: { label: "", config: { amount: 10, unit: "seconds", essential: false } } });
    more.edges = more.edges.filter((e) => !(e.source === "n_confirm"));
    more.edges.push({ id: "x1", source: "n_confirm", target: "w2", sourceHandle: "out" });
    more.edges.push({ id: "x2", source: "w2", target: "n_end", sourceHandle: "out" });
    const r1 = estimateFlow({ flowName: "a", definition, assumptions: base, plan });
    const r2 = estimateFlow({ flowName: "a", definition: more, assumptions: base, plan });
    expect(r2.daily.qstashDeliveries).toBeGreaterThan(r1.daily.qstashDeliveries);
  });

  it("recalculates when customer volume changes", () => {
    const r10 = estimateFlow({ flowName: "a", definition, assumptions: { ...base, customersPerDay: 10 }, plan });
    const r100 = estimateFlow({ flowName: "a", definition, assumptions: { ...base, customersPerDay: 100 }, plan });
    expect(r100.daily.whatsappReplies).toBeCloseTo(r10.daily.whatsappReplies * 10, 5);
  });

  it("warns clearly when a flow is projected to exceed an allowance", () => {
    const r = estimateFlow({
      flowName: "Heavy",
      definition,
      assumptions: { ...base, customersPerDay: 400, scheduledPerCustomerOverride: 3 },
      plan,
    });
    expect(r.overallLevel).toBe("exceeded");
    expect(r.warnings.some((w) => w.includes("exceeds the configured daily allowance"))).toBe(true);
    expect(r.recommendation).toMatch(/Do not publish/);
  });

  it("subtracts other active flows' usage from shared capacity", () => {
    const alone = estimateFlow({ flowName: "a", definition, assumptions: base, plan });
    const shared = estimateFlow({
      flowName: "a",
      definition,
      assumptions: base,
      plan: { ...plan, otherFlows: { ...plan.otherFlows, qstashPerDay: 900 } },
    });
    expect(shared.capacity.qstashCustomersPerDay!).toBeLessThan(alone.capacity.qstashCustomersPerDay!);
    expect(shared.quotas[0].projected).toBe(alone.quotas[0].projected + 900);
  });

  it("handles flows with zero scheduled tasks without dividing by zero", () => {
    const noWait: FlowDefinition = {
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { label: "", config: {} } },
        { id: "m", type: "send_message", position: { x: 0, y: 0 }, data: { label: "", config: { text: "Hi" } } },
      ],
      edges: [{ id: "e", source: "t", target: "m", sourceHandle: "out" }],
    };
    const r = estimateFlow({ flowName: "a", definition: noWait, assumptions: base, plan });
    expect(r.daily.qstashDeliveries).toBe(0);
    expect(r.capacity.qstashCustomersPerDay).toBeNull();
    expect(Number.isFinite(r.quotas[0].pct!)).toBe(true);
  });

  it("separates delivered replies from billable messages and labels the rate source", () => {
    const r = estimateFlow({ flowName: "a", definition, assumptions: base, plan });
    expect(r.meta.deliveredReplies).toBeGreaterThan(0);
    expect(r.meta.billableMessages).toBe(0);
    expect(r.meta.rateSource).toBe("manual");
    const none = estimateFlow({ flowName: "a", definition, assumptions: base, plan: { ...plan, metaRate: null } });
    expect(none.meta.rateSource).toBe("unavailable");
    expect(none.meta.estimatedCost).toBeNull();
  });

  it("maps usage to the specified warning bands", () => {
    expect(warningLevel(0.69)).toBe("normal");
    expect(warningLevel(0.7)).toBe("info");
    expect(warningLevel(0.84)).toBe("info");
    expect(warningLevel(0.85)).toBe("high");
    expect(warningLevel(0.95)).toBe("critical");
    expect(warningLevel(0.99)).toBe("critical");
    expect(warningLevel(1)).toBe("exceeded");
    expect(warningLevel(1.4)).toBe("exceeded");
  });

  it("models daily growth across 30 days", () => {
    const r = estimateFlow({ flowName: "a", definition, assumptions: { ...base, dailyGrowthRate: 0.05 }, plan });
    expect(r.peakDay.customers).toBeGreaterThan(r.daily.customers * 3);
    expect(r.monthly.customers).toBeGreaterThan(20 * 30);
  });
});
