import { SegmentedNav } from "./segmented-nav";

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(v: unknown): RangeKey {
  return typeof v === "string" && v in RANGES ? (v as RangeKey) : "30d";
}

export function RangeFilter({ value, basePath, extra }: { value: RangeKey; basePath: string; extra?: Record<string, string> }) {
  return (
    <SegmentedNav
      items={(Object.keys(RANGES) as RangeKey[]).map((k) => ({
        href: `${basePath}?${new URLSearchParams({ ...extra, range: k }).toString()}`,
        label: `Last ${k.replace("d", " days")}`,
        active: value === k,
      }))}
    />
  );
}
