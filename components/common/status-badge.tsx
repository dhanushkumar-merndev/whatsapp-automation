import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-success/10 text-success ring-success/25",
  blue: "bg-info/10 text-info ring-info/25",
  amber: "bg-warning/10 text-warning ring-warning/25",
  red: "bg-destructive/10 text-destructive ring-destructive/25",
  gray: "bg-muted text-muted-foreground ring-border",
  violet: "bg-violet/10 text-violet ring-violet/25",
} as const;
export type Tone = keyof typeof TONES;

/** Tinted pill colours shared by status-style badges; theme-aware via semantic tokens. */
export function toneClass(tone: Tone): string {
  return TONES[tone];
}

const STATUS_TONES: Record<string, Tone> = {
  active: "green",
  completed: "green",
  booked: "blue",
  confirmed: "green",
  no_show: "gray",
  succeeded: "green",
  synced: "green",
  qualified: "green",
  sent: "blue",
  delivered: "green",
  read: "green",
  ready: "green",
  open: "green",
  success: "green",
  testing: "violet",
  new: "blue",
  running: "blue",
  waiting_input: "blue",
  waiting_delay: "blue",
  scheduled: "blue",
  pending: "amber",
  retrying: "amber",
  deferred: "amber",
  incomplete: "amber",
  handoff: "amber",
  paused: "amber",
  draft: "gray",
  invited: "amber",
  window_expired: "amber",
  rate_limited: "amber",
  skipped: "gray",
  cancelled: "gray",
  abandoned: "gray",
  archived: "gray",
  closed: "gray",
  not_configured: "gray",
  received: "gray",
  processed: "gray",
  ignored: "gray",
  contacted: "violet",
  won: "green",
  lost: "gray",
  failed: "red",
  rejected: "red",
  disabled: "red",
};

export function StatusBadge({ status, tone, label, className }: { status: string; tone?: Tone; label?: string; className?: string }) {
  const t = tone ?? STATUS_TONES[status] ?? "gray";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        toneClass(t),
        className,
      )}
    >
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}
