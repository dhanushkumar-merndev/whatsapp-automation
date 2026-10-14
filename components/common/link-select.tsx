"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** A dropdown whose options are links, for filters with many choices. */
export function LinkSelect({
  value,
  options,
  className,
  label,
}: {
  value: string;
  options: { value: string; label: string; href: string }[];
  className?: string;
  label: string;
}) {
  const router = useRouter();
  return (
    <Select value={value} onValueChange={(v) => router.push(options.find((o) => o.value === v)?.href ?? "", { scroll: false })}>
      <SelectTrigger size="sm" className={cn("w-48 rounded-full", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
