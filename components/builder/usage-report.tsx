"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVEL_LABEL, type EstimateReport, type QuotaUsage, type WarningLevel } from "@/lib/estimator/estimate";
import { fmtBytes, fmtMoney, fmtNumber } from "@/lib/format";
import { SourceBadge } from "@/components/common/source-badge";

export const LEVEL_STYLES: Record<WarningLevel, { bar: string; text: string; bg: string; Icon: typeof Info }> = {
  normal: { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", Icon: CheckCircle2 },
  info: { bar: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50 border-blue-200", Icon: Info },
  high: { bar: "bg-amber-500", text: "text-amber-800", bg: "bg-amber-50 border-amber-200", Icon: AlertTriangle },
  critical: { bar: "bg-orange-600", text: "text-orange-800", bg: "bg-orange-50 border-orange-200", Icon: AlertTriangle },
  exceeded: { bar: "bg-red-600", text: "text-red-700", bg: "bg-red-50 border-red-200", Icon: OctagonAlert },
};

function fmtQuota(q: QuotaUsage, v: number) {
  return q.unit === "bytes" ? fmtBytes(v) : fmtNumber(v);
}

export function LevelPill({ level }: { level: WarningLevel }) {
  const s = LEVEL_STYLES[level];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", s.bg, s.text)}>
      <s.Icon className="size-3" />
      {LEVEL_LABEL[level]}
    </span>
  );
}

export function QuotaBar({ q }: { q: QuotaUsage }) {
  const pct = q.pct === null ? null : Math.min(1, q.pct);
  const worst = q.pctWorst === null ? null : Math.min(1, q.pctWorst);
  const s = LEVEL_STYLES[q.level];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">
          {q.label} <span className="font-normal text-muted-foreground">/ {q.period === "total" ? "total" : q.period}</span>
        </span>
        <span className={cn("tabular-nums", s.text)}>{q.pct === null ? "no limit set" : `${(q.pct * 100).toFixed(q.pct < 0.1 ? 1 : 0)}%`}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        {worst !== null && <div className="absolute inset-y-0 left-0 bg-muted-foreground/20" style={{ width: `${worst * 100}%` }} />}
        {pct !== null && <div className={cn("absolute inset-y-0 left-0 rounded-full", s.bar)} style={{ width: `${Math.max(pct * 100, 0.5)}%` }} />}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>
          {fmtQuota(q, q.projected)}
          {q.limit !== null && ` of ${fmtQuota(q, q.limit)}`}
          {q.sharedWithOtherFlows > 0 && ` (incl. ${fmtQuota(q, q.sharedWithOtherFlows)} other flows)`}
        </span>
        <span>worst {fmtQuota(q, q.projectedWorst)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function UsageReportView({ report, compact = false }: { report: EstimateReport; compact?: boolean }) {
  const r = report;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <LevelPill level={r.overallLevel} />
        <SourceBadge source="estimate" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="WhatsApp replies / day" value={fmtNumber(r.daily.whatsappReplies)} sub={`${fmtNumber(r.perCustomer.typical.outgoing, 1)} per customer`} />
        <Stat label="Replies / 30 days" value={fmtNumber(r.monthly.whatsappReplies)} sub={`worst ${fmtNumber(r.monthly.whatsappRepliesWorst)}`} />
        <Stat label="QStash / day" value={fmtNumber(r.daily.qstashDeliveries, 1)} sub={`worst ${fmtNumber(r.peakDay.qstashWorst)} (peak day)`} />
        <Stat label="QStash / 30 days" value={fmtNumber(r.monthly.qstashDeliveries)} sub={`worst ${fmtNumber(r.monthly.qstashWorst)}`} />
        <Stat label="Redis commands / month" value={fmtNumber(r.monthly.redisCommands)} sub="rate-limit checks (estimate)" />
        <Stat label="DB growth / month" value={fmtBytes(r.monthly.dbGrowthBytes)} sub={`${fmtNumber(r.monthly.customers)} conversations`} />
      </div>

      <div className="space-y-3">
        {r.quotas.map((q) => (
          <QuotaBar key={q.key} q={q} />
        ))}
      </div>

      <div className="rounded-md border p-2.5 text-xs">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">Meta WhatsApp charges (30 days)</span>
          <SourceBadge source={r.meta.rateSource === "manual" ? "manual" : "unavailable"} />
        </div>
        <div className="grid grid-cols-3 gap-2 tabular-nums">
          <div>
            <div className="text-[10px] text-muted-foreground">Delivered replies</div>
            {fmtNumber(r.meta.deliveredReplies)}
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Billable</div>
            {r.meta.billableMessages === null ? "unknown" : fmtNumber(r.meta.billableMessages)}
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Est. cost</div>
            {r.meta.estimatedCost === null ? "unavailable" : fmtMoney(r.meta.estimatedCost, r.meta.currency ?? "USD")}
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">{r.meta.note} QStash allowances are never treated as WhatsApp allowances.</p>
      </div>

      <div className="rounded-md border p-2.5 text-xs">
        <div className="font-medium">Capacity</div>
        <p className="mt-0.5 text-muted-foreground">
          {r.capacity.maxCustomersPerDay === null
            ? "No configured allowance limits the daily customer volume of this flow."
            : `About ${fmtNumber(r.capacity.maxCustomersPerDay)} customers/day before ${r.capacity.limitingResource} runs out (after other active flows).`}
        </p>
        {r.capacity.qstashCustomersPerDay === null && r.perCustomer.typical.scheduled === 0 && (
          <p className="mt-0.5 text-muted-foreground">This flow schedules no QStash deliveries.</p>
        )}
      </div>

      {!compact && (
        <div className="space-y-1.5">
          {r.warnings.map((w, i) => (
            <p key={i} className="rounded-md bg-muted/60 p-2 text-[11px] leading-snug">
              {w}
            </p>
          ))}
        </div>
      )}
      <p className="text-xs">
        <span className="font-medium">Recommendation: </span>
        {r.recommendation}
      </p>
    </div>
  );
}
