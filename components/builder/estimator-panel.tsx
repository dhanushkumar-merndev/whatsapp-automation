"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { CUSTOMER_PRESETS, type EstimateReport, type EstimatorAssumptions } from "@/lib/estimator/estimate";
import { cn } from "@/lib/utils";
import { UsageReportView } from "./usage-report";

function NumInput({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  min = 0,
  max,
  placeholder,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={value ?? ""}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="h-7 text-sm tabular-nums"
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function EstimatorPanel({
  assumptions,
  onChange,
  report,
}: {
  assumptions: EstimatorAssumptions;
  onChange: (a: EstimatorAssumptions) => void;
  report: EstimateReport;
}) {
  const a = assumptions;
  const set = (patch: Partial<EstimatorAssumptions>) => onChange({ ...a, ...patch });
  const pct = (v: number) => Math.round(v * 1000) / 10;
  const isPreset = (CUSTOMER_PRESETS as readonly number[]).includes(a.customersPerDay);
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-sm font-medium">Flow Usage Estimator</div>
        <p className="text-[11px] text-muted-foreground">Updates instantly as you edit nodes or assumptions.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Customers per day</Label>
        <div className="flex flex-wrap gap-1">
          {CUSTOMER_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set({ customersPerDay: p })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs tabular-nums transition-colors",
                a.customersPerDay === p ? "border-foreground bg-foreground font-medium text-background" : "hover:bg-muted",
              )}
            >
              {p}
            </button>
          ))}
          <Input
            type="number"
            min={0}
            value={a.customersPerDay}
            onChange={(e) => set({ customersPerDay: Math.max(0, Number(e.target.value) || 0) })}
            className={cn("h-7 w-20 rounded-full text-xs tabular-nums", !isPreset && "border-foreground")}
            aria-label="Custom customers per day"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="Completion rate" suffix="%" value={pct(a.completionRate)} onChange={(v) => set({ completionRate: Math.min(1, Math.max(0, (v ?? 0) / 100)) })} />
        <NumInput label="Daily growth" suffix="%" step={0.5} min={-50} value={pct(a.dailyGrowthRate)} onChange={(v) => set({ dailyGrowthRate: (v ?? 0) / 100 })} />
        <NumInput label="Invalid answers / question" step={0.1} value={a.validationRetriesPerQuestion} onChange={(v) => set({ validationRetriesPerQuestion: v ?? 0 })} />
        <NumInput label="QStash retry rate" suffix="%" value={pct(a.qstashRetryRate)} onChange={(v) => set({ qstashRetryRate: Math.min(1, Math.max(0, (v ?? 0) / 100)) })} />
        <NumInput label="Avg. media size" suffix="MB" step={0.5} value={a.averageMediaSizeMb} onChange={(v) => set({ averageMediaSizeMb: v ?? 0 })} />
        <NumInput label="New media / month" value={a.newMediaAssetsPerMonth} onChange={(v) => set({ newMediaAssetsPerMonth: v ?? 0 })} />
        <NumInput label="DB per conversation" suffix="KB" value={a.dbKbPerConversation} onChange={(v) => set({ dbKbPerConversation: v ?? 0 })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumInput
          label="Replies / customer (override)"
          step={0.5}
          value={a.outgoingPerCustomerOverride ?? null}
          placeholder={String(report.perCustomer.derivedOutgoing)}
          onChange={(v) => set({ outgoingPerCustomerOverride: v })}
        />
        <NumInput
          label="Scheduled / customer (override)"
          step={0.5}
          value={a.scheduledPerCustomerOverride ?? null}
          placeholder={String(report.perCustomer.derivedScheduled)}
          onChange={(v) => set({ scheduledPerCustomerOverride: v })}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Derived from this flow: {report.perCustomer.derivedOutgoing} replies and {report.perCustomer.derivedScheduled} QStash
        deliveries per customer. Only Wait steps (and CRM retries) use QStash; immediate steps cost nothing.
      </p>
      <Separator />
      <UsageReportView report={report} />
    </div>
  );
}
