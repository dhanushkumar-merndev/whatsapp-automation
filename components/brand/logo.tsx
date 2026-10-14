import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="size-4.5" fill="currentColor" aria-hidden>
          <path d="M12 2.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6L3.3 8.8l6.1-.7z" />
        </svg>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-sm font-semibold">Star Growth Hub</div>
          <div className="text-[11px] text-muted-foreground">WhatsApp Automation</div>
        </div>
      )}
    </div>
  );
}
