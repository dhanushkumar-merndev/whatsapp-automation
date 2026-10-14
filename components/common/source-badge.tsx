import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Distinguishes provider-reported figures from local measurements and estimates. */
const SOURCES = {
  provider: { label: "Provider reported", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", tip: "Reported by the provider's API." },
  local_measured: {
    label: "Local count",
    cls: "bg-blue-50 text-blue-700 ring-blue-600/20",
    tip: "Counted by this application. Not an official provider billing figure.",
  },
  measured: {
    label: "Measured",
    cls: "bg-blue-50 text-blue-700 ring-blue-600/20",
    tip: "Measured directly from the database/storage. Not an official billing figure.",
  },
  estimate: {
    label: "Estimate",
    cls: "bg-amber-50 text-amber-800 ring-amber-600/20",
    tip: "Calculated from assumptions. Not live data.",
  },
  manual: {
    label: "Manually configured",
    cls: "bg-violet-50 text-violet-700 ring-violet-600/20",
    tip: "Entered by an administrator. Verify against your provider account.",
  },
  unavailable: { label: "Unavailable", cls: "bg-muted text-muted-foreground ring-border", tip: "No data source is configured." },
} as const;
export type DataSource = keyof typeof SOURCES;

export function SourceBadge({ source, className }: { source: DataSource; className?: string }) {
  const s = SOURCES[source];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset",
            s.cls,
            className,
          )}
        >
          {s.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{s.tip}</TooltipContent>
    </Tooltip>
  );
}
