import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { FilterPills } from "@/components/common/filter-pills";
import { StatusBadge } from "@/components/common/status-badge";
import { Card } from "@/components/ui/card";
import { BookingActions } from "@/components/bookings/booking-actions";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings/server";
import { formatDay, todayIn } from "@/lib/engine/input-types";
import { timeLabel, zonedToUtc } from "@/lib/engine/booking";
import { fmtPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Bookings" };

const VIEWS = { upcoming: "Upcoming", today: "Today", past: "Past", cancelled: "Cancelled", all: "All" } as const;
type View = keyof typeof VIEWS;

/** Date and time of an instant in the business timezone. */
function local(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export default async function BookingsPage({ searchParams }: PageProps<"/bookings">) {
  await requirePageSession("staff");
  const sp = await searchParams;
  const view: View = typeof sp.view === "string" && sp.view in VIEWS ? (sp.view as View) : "upcoming";
  const { business } = await loadSettings();
  const tz = business.timezone;
  const now = new Date();
  const today = todayIn(tz, now);
  /** Midnight (business timezone) `offsetDays` from today, as an instant. */
  const dayStart = (offsetDays: number) =>
    zonedToUtc(new Date(today.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10), "00:00", tz).toISOString();

  const supabase = await createClient();
  let q = supabase
    .from("bookings")
    .select("id, starts_at, ends_at, status, service, notes, is_test, conversation_id, contacts(wa_id, name, profile_name)")
    .limit(500);
  if (view === "upcoming") q = q.gte("starts_at", now.toISOString()).in("status", ["booked", "confirmed"]).order("starts_at");
  else if (view === "today") q = q.gte("starts_at", dayStart(0)).lt("starts_at", dayStart(1)).order("starts_at");
  else if (view === "past") q = q.lt("starts_at", now.toISOString()).neq("status", "cancelled").order("starts_at", { ascending: false });
  else if (view === "cancelled") q = q.eq("status", "cancelled").order("starts_at", { ascending: false });
  else q = q.order("starts_at", { ascending: false });
  const [{ data: bookings, error }, { count: upcoming }] = await Promise.all([
    q,
    supabase.from("bookings").select("id", { count: "exact", head: true }).gte("starts_at", now.toISOString()).in("status", ["booked", "confirmed"]),
  ]);

  const groups = new Map<string, NonNullable<typeof bookings>>();
  for (const b of bookings ?? []) {
    const { date } = local(b.starts_at, tz);
    groups.set(date, [...(groups.get(date) ?? []), b]);
  }

  return (
    <>
      <PageHeader title="Bookings" description={`Appointments booked through WhatsApp. Times in ${tz}.`} />
      <FilterPills
        className="mb-4"
        items={(Object.keys(VIEWS) as View[]).map((v) => ({
          href: v === "upcoming" ? "/bookings" : `/bookings?view=${v}`,
          label: VIEWS[v],
          active: v === view,
          count: v === "upcoming" ? (upcoming ?? 0) : undefined,
        }))}
      />
      {error && <p className="mb-4 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error.message}</p>}
      {!bookings?.length ? (
        <EmptyState
          icon={CalendarDays}
          title={view === "upcoming" ? "No upcoming bookings" : "Nothing here"}
          description="Add a Booking step to your workflow: customers pick a day and a free time right in WhatsApp."
        />
      ) : (
        <div className="space-y-5">
          {[...groups].map(([date, items]) => (
            <section key={date}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{formatDay(date)}</h2>
              <Card className="divide-y py-0">
                {items.map((b) => {
                  const c = (Array.isArray(b.contacts) ? b.contacts[0] : b.contacts) as { wa_id: string; name: string | null; profile_name: string | null } | null;
                  const { time } = local(b.starts_at, tz);
                  const end = local(b.ends_at, tz).time;
                  return (
                    <div key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                      <div className="w-36 shrink-0 text-sm font-medium tabular-nums">
                        {timeLabel(time)} – {timeLabel(end)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link href={`/conversations/${b.conversation_id}`} className="text-sm font-medium hover:underline">
                          {c?.name ?? c?.profile_name ?? fmtPhone(c?.wa_id)}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">
                          {[fmtPhone(c?.wa_id), b.service, b.notes].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {b.is_test && <StatusBadge status="test" tone="violet" />}
                      <StatusBadge status={b.status} label={b.status === "no_show" ? "no-show" : undefined} />
                      <BookingActions id={b.id} status={b.status} when={`${formatDay(date)} at ${timeLabel(time)}`} />
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
