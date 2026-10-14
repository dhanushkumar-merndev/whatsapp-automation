import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceBadge, type DataSource } from "./source-badge";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  href,
  source,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  href?: string;
  source?: DataSource;
  tone?: "default" | "warning" | "critical";
}) {
  const body = (
    <div
      className={cn(
        "h-full rounded-2xl border p-4 transition-colors",
        href && "hover:bg-muted/40",
        tone === "warning" && "border-amber-200 bg-amber-50/50",
        tone === "critical" && "border-red-200 bg-red-50/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        {source && <SourceBadge source={source} />}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
