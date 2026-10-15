import { WEEKDAY_IDS, type BookingConfig } from "./schema";
import type { InboundInput, OutboundMessage } from "./types";
import { formatDay, parseDate, todayIn } from "./input-types";
import { renderTemplate, type TemplateScope } from "./template";

/**
 * Appointment slots for the "Booking" step. Times are wall-clock times in the
 * business timezone; bookings are stored as UTC instants. Browser-safe.
 */


export interface Slot {
  date: string;
  time: string;
  startsAt: string;
  endsAt: string;
}

export interface BookingAnswer {
  kind: "booking";
  id: string;
  date: string;
  time: string;
  startsAt: string;
  endsAt: string;
  /** "Thu, 15 Oct 2026 at 10:30 AM" — what {{vars.booking}} shows. */
  title: string;
  raw: string;
}

/** Progress of a booking conversation, kept in the execution variables. */
export interface BookingState {
  stage: "date" | "time";
  date?: string;
  offset?: number;
}

const DAY_MS = 86_400_000;

function tzOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of a wall-clock date + time in a timezone. */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - tzOffsetMs(new Date(guess), timezone);
  return new Date(guess);
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** "10:30" → "10:30 AM". */
export function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Thu, 15 Oct" — fits a list row title. */
export function shortDay(iso: string): string {
  return formatDay(iso).replace(/ \d{4}$/, "");
}

export function whenLabel(date: string, time: string): string {
  return `${formatDay(date)} at ${timeLabel(time)}`;
}

/** All slots of one day, before availability. */
export function daySlots(cfg: BookingConfig, date: string, timezone: string): Slot[] {
  const out: Slot[] = [];
  for (let t = minutes(cfg.startTime); t + cfg.slotMinutes <= minutes(cfg.endTime); t += cfg.slotMinutes) {
    const start = zonedToUtc(date, hhmm(t), timezone);
    out.push({ date, time: hhmm(t), startsAt: start.toISOString(), endsAt: new Date(start.getTime() + cfg.slotMinutes * 60_000).toISOString() });
  }
  return out;
}

/** Days (from today, in order) that still have free slots, with those slots. */
export function availableDays(
  cfg: BookingConfig,
  opts: { timezone: string; now: Date; taken: Map<number, number> },
): { date: string; slots: Slot[] }[] {
  const today = todayIn(opts.timezone, opts.now);
  const earliest = opts.now.getTime() + cfg.minNoticeMinutes * 60_000;
  const out: { date: string; slots: Slot[] }[] = [];
  for (let i = 0; i < cfg.daysAhead; i++) {
    const day = new Date(today.getTime() + i * DAY_MS);
    const date = day.toISOString().slice(0, 10);
    if (!cfg.days.includes(WEEKDAY_IDS[day.getUTCDay()]) || cfg.blockedDates.includes(date)) continue;
    const slots = daySlots(cfg, date, opts.timezone).filter(
      (s) => new Date(s.startsAt).getTime() >= earliest && (opts.taken.get(new Date(s.startsAt).getTime()) ?? 0) < cfg.capacity,
    );
    if (slots.length) out.push({ date, slots });
  }
  return out;
}

/** The time window to look up existing bookings for. */
export function bookingWindow(cfg: BookingConfig, timezone: string, now: Date) {
  const today = todayIn(timezone, now);
  return { from: new Date(today.getTime() - DAY_MS).toISOString(), to: new Date(today.getTime() + (cfg.daysAhead + 1) * DAY_MS).toISOString() };
}

const MAX_ROWS = 10;
const TIME_ROWS = 8;

export function dateListMessage(cfg: BookingConfig, days: { date: string; slots: Slot[] }[], scope: TemplateScope, notice?: string): OutboundMessage {
  const body = [renderTemplate(cfg.datePrompt, scope), notice].filter(Boolean).join("\n\n").slice(0, 1024);
  return {
    kind: "list",
    body,
    buttonText: "Pick a day",
    rows: days.slice(0, MAX_ROWS).map((d) => ({
      id: `d:${d.date}`,
      title: shortDay(d.date),
      description: `${d.slots.length} time${d.slots.length === 1 ? "" : "s"} free`,
    })),
  };
}

export function timeListMessage(cfg: BookingConfig, date: string, slots: Slot[], offset: number, scope: TemplateScope, notice?: string): OutboundMessage {
  const page = slots.slice(offset, offset + TIME_ROWS);
  const more = offset + TIME_ROWS < slots.length;
  const body = [renderTemplate(cfg.timePrompt, { ...scope, booking: { date: formatDay(date) } }), notice].filter(Boolean).join("\n\n").slice(0, 1024);
  return {
    kind: "list",
    body,
    buttonText: "Pick a time",
    rows: [
      ...page.map((s) => ({ id: `t:${s.time}`, title: timeLabel(s.time) })),
      ...(more ? [{ id: `more:${offset + TIME_ROWS}`, title: "Later times ›" }] : offset > 0 ? [{ id: "more:0", title: "‹ Earlier times" }] : []),
      { id: "back", title: "‹ Another day" },
    ],
  };
}

/** "10:30", "10.30", "10am", "4 pm", "16:00" → "HH:MM". */
export function parseTime(text: string): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (min > 59 || h > 23) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return hhmm(h * 60 + min);
}

export type BookingReply =
  | { kind: "date"; date: string }
  | { kind: "time"; time: string }
  | { kind: "page"; offset: number }
  | { kind: "back" }
  | { kind: "unknown" };

export function parseBookingReply(
  state: BookingState,
  input: InboundInput,
  opts: { timezone: string; now: Date; days: string[]; times: string[] },
): BookingReply {
  const id = input.replyId ?? "";
  if (id.startsWith("d:")) return { kind: "date", date: id.slice(2) };
  if (id.startsWith("t:")) return { kind: "time", time: id.slice(2) };
  if (id.startsWith("more:")) return { kind: "page", offset: Number(id.slice(5)) || 0 };
  if (id === "back") return { kind: "back" };
  const text = (input.text ?? "").trim();
  const n = /^#?(\d{1,2})[.)]?$/.exec(text);
  if (state.stage === "date") {
    if (n && opts.days[Number(n[1]) - 1]) return { kind: "date", date: opts.days[Number(n[1]) - 1] };
    const d = parseDate(text, opts.timezone, opts.now);
    return d ? { kind: "date", date: d.toISOString().slice(0, 10) } : { kind: "unknown" };
  }
  if (/^(back|change|another day|other day)$/i.test(text)) return { kind: "back" };
  // A bare number is a row of the list shown; "10am" or "16:30" is a time.
  if (n && opts.times[Number(n[1]) - 1]) return { kind: "time", time: opts.times[Number(n[1]) - 1] };
  const t = parseTime(text);
  return t ? { kind: "time", time: t } : { kind: "unknown" };
}
