import type { AppSettings } from "@/lib/settings/schema";

/** Whether `now` falls inside the opening hours set in Settings (business timezone). */
export function isWithinBusinessHours(business: AppSettings["business"], now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = business.hours[get("weekday").toLowerCase().slice(0, 3) as keyof AppSettings["business"]["hours"]];
  if (!day?.open) return false;
  const mins = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const t = Number(get("hour")) * 60 + Number(get("minute"));
  return t >= mins(day.from) && t < mins(day.to);
}
