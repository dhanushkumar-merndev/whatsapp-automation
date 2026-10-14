import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  gray: "bg-muted text-muted-foreground ring-border",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
} as const;
export type Tone = keyof typeof TONES;

const STATUS_TONES: Record<string, Tone> = {
  active: "green",
  completed: "green",
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

export function StatusBadge({ status, tone, className }: { status: string; tone?: Tone; className?: string }) {
  const t = tone ?? STATUS_TONES[status] ?? "gray";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        TONES[t],
        className,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
