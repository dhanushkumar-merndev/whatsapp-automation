import Link from "next/link";
import { cn } from "@/lib/utils";

export interface FilterPill {
  href: string;
  label: string;
  active: boolean;
  count?: number;
}

/** Row of link chips for switching list views; scrolls sideways on small screens. */
export function FilterPills({ items, className }: { items: FilterPill[]; className?: string }) {
  return (
    <div className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)}>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs whitespace-nowrap transition-colors",
            i.active ? "border-foreground bg-foreground font-medium text-background" : "text-foreground/80 hover:bg-muted",
          )}
        >
          {i.label}
          {i.count !== undefined && i.count > 0 && (
            <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", i.active ? "bg-background/20" : "bg-muted text-muted-foreground")}>{i.count}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
