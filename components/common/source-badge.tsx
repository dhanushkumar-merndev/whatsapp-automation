import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toneClass } from "./status-badge";

/** Distinguishes provider-reported figures from local measurements and estimates. */
const SOURCES = {
  provider: { label: "Provider reported", cls: toneClass("green"), tip: "Reported by the provider's API." },
  local_measured: {
    label: "Local count",
    cls: toneClass("blue"),
    tip: "Counted by this application. Not an official provider billing figure.",
  },
  measured: {
    label: "Measured",
    cls: toneClass("blue"),
    tip: "Measured directly from the database/storage. Not an official billing figure.",
  },
  estimate: {
    label: "Estimate",
    cls: toneClass("amber"),
    tip: "Calculated from assumptions. Not live data.",
  },
  manual: {
    label: "Manually configured",
    cls: toneClass("violet"),
    tip: "Entered by an administrator. Verify against your provider account.",
  },
  unavailable: { label: "Unavailable", cls: toneClass("gray"), tip: "No data source is configured." },
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
