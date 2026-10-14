import Link from "next/link";
import { cn } from "@/lib/utils";

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(v: unknown): RangeKey {
  return typeof v === "string" && v in RANGES ? (v as RangeKey) : "30d";
}

export function RangeFilter({ value, basePath, extra }: { value: RangeKey; basePath: string; extra?: Record<string, string> }) {
  return (
    <div className="inline-flex rounded-full bg-muted p-1">
      {(Object.keys(RANGES) as RangeKey[]).map((k) => (
        <Link
          key={k}
          href={{ pathname: basePath, query: { ...extra, range: k } }}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === k ? "bg-background text-foreground shadow-sm dark:bg-accent" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Last {k.replace("d", " days")}
        </Link>
      ))}
    </div>
  );
}
