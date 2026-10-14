import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SegmentedItem {
  href: string;
  label: string;
  active: boolean;
}

/** Pill-shaped segmented tabs made of links (Settings sections, Logs tabs, date ranges). */
export function SegmentedNav({ items, className }: { items: SegmentedItem[]; className?: string }) {
  return (
    <nav className={cn("inline-flex max-w-full overflow-x-auto rounded-full bg-muted p-1 [scrollbar-width:none]", className)}>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
            i.active ? "bg-background text-foreground shadow-sm dark:bg-accent" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
