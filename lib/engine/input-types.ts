import type { InboundInput } from "./types";

/**
 * Typed answers for "Ask question". Each parser turns a customer reply into a
 * stored value or explains why it is not acceptable. Values that are objects
 * carry a `title`, which is what {{vars.x}} shows in messages.
 * Browser-safe (used by the simulator too).
 */

export const INPUT_TYPES = ["text", "number", "email", "phone", "date", "url", "media", "location"] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const DEFAULT_INPUT_ERRORS: Record<InputType, string> = {
  text: "Please type your answer.",
  number: "Please reply with a number.",
  email: "That doesn't look like an email address. Please type it again.",
  phone: "Please send a valid phone number.",
  date: "Please send a date, for example 25/10 or tomorrow.",
  url: "Please send a website link.",
  media: "Please send a photo or a file.",
  location: "Please share your location (📎 → Location).",
};

export interface DateAnswer {
  kind: "date";
  /** YYYY-MM-DD in the business timezone. */
  iso: string;
  title: string;
  raw: string;
}
export interface MediaAnswer {
  kind: "media";
  type: string;
  mediaId: string | null;
  messageId: string | null;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
  title: string;
  raw: string;
}
export interface LocationAnswer {
  kind: "location";
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
  mapUrl: string;
  title: string;
  raw: string;
}

export type ParsedAnswer = { ok: true; value: string | DateAnswer | MediaAnswer | LocationAnswer } | { ok: false };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Calendar date "today" in a timezone, as a UTC-midnight Date (for day arithmetic). */
export function todayIn(timezone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** "Thu, 15 Oct 2026" — built by hand so it reads the same on every server. */
export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return `${cap(WEEKDAYS[d.getUTCDay()])}, ${d.getUTCDate()} ${cap(MONTHS[d.getUTCMonth()])} ${d.getUTCFullYear()}`;
}

function validDate(y: number, m: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/** Understands 25/10, 25-10-2026, 2026-10-25, 25 Oct, Oct 25, today, tomorrow, day after tomorrow, monday… */
export function parseDate(text: string, timezone: string, now: Date): Date | null {
  const t = text.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  const today = todayIn(timezone, now);
  if (/^(today|now)$/.test(t)) return today;
  if (/^(tomorrow|tmrw|tmr|tom)$/.test(t)) return addDays(today, 1);
  if (/^day after (tomorrow|tmrw)$/.test(t)) return addDays(today, 2);
  const wd = /^(next |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(t);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]);
    let diff = (target - today.getUTCDay() + 7) % 7;
    if (diff === 0 || wd[1] === "next ") diff = diff === 0 ? 7 : diff;
    return addDays(today, diff);
  }
  // A date without a year is the next one on or after today.
  const upcoming = (m: number, d: number) => {
    const y = today.getUTCFullYear();
    const dt = validDate(y, m, d);
    if (!dt) return null;
    return dt < today ? validDate(y + 1, m, d) : dt;
  };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/.exec(t);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    return year ? validDate(year, +m[2], +m[1]) : upcoming(+m[2], +m[1]);
  }
  m = /^(\d{1,2}) ([a-z]{3,9})(?: (\d{4}))?$/.exec(t) ?? null;
  const n = m ? null : /^([a-z]{3,9}) (\d{1,2})(?: (\d{4}))?$/.exec(t);
  if (m || n) {
    const day = +(m ? m[1] : n![2]);
    const month = MONTHS.indexOf((m ? m[2] : n![1]).slice(0, 3)) + 1;
    const year = m ? m[3] : n![3];
    if (month < 1) return null;
    return year ? validDate(+year, month, day) : upcoming(month, day);
  }
  return null;
}

export function parseAnswer(
  type: InputType,
  input: InboundInput,
  opts: { timezone: string; now: Date; min?: number | null; max?: number | null },
): ParsedAnswer {
  const raw = (input.replyTitle ?? input.text ?? "").trim();
  switch (type) {
    case "text":
      return raw ? { ok: true, value: raw.slice(0, 4096) } : { ok: false };
    case "number": {
      const m = /-?\d+(?:\.\d+)?/.exec(raw.replace(/(\d),(?=\d)/g, "$1").replace(/\s+/g, ""));
      if (!m) return { ok: false };
      const value = Number(m[0]);
      if ((opts.min !== null && opts.min !== undefined && value < opts.min) || (opts.max !== null && opts.max !== undefined && value > opts.max)) {
        return { ok: false };
      }
      return { ok: true, value: m[0] };
    }
    case "email":
      return EMAIL.test(raw) ? { ok: true, value: raw.toLowerCase() } : { ok: false };
    case "phone": {
      const digits = raw.replace(/[\s()-]/g, "");
      return /^\+?\d{6,15}$/.test(digits) ? { ok: true, value: digits } : { ok: false };
    }
    case "url": {
      const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        const u = new URL(candidate);
        return /\.[a-z]{2,}$/i.test(u.hostname) && !/\s/.test(raw) ? { ok: true, value: u.toString() } : { ok: false };
      } catch {
        return { ok: false };
      }
    }
    case "date": {
      const d = parseDate(raw, opts.timezone, opts.now);
      if (!d) return { ok: false };
      const iso = isoDay(d);
      return { ok: true, value: { kind: "date", iso, title: formatDay(iso), raw } };
    }
    case "media": {
      if (!input.media) return { ok: false };
      const label = { image: "photo", document: "file", video: "video", audio: "voice note", sticker: "sticker" }[input.media.type] ?? "file";
      return {
        ok: true,
        value: {
          kind: "media",
          type: input.media.type,
          mediaId: input.media.mediaId,
          messageId: input.messageId ?? null,
          mimeType: input.media.mimeType,
          filename: input.media.filename,
          caption: input.media.caption,
          title: input.media.caption ? `[${label}] ${input.media.caption}` : `[${label}]`,
          raw,
        },
      };
    }
    case "location": {
      const l = input.location;
      if (!l || !Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) return { ok: false };
      const mapUrl = `https://maps.google.com/?q=${l.latitude},${l.longitude}`;
      return {
        ok: true,
        value: {
          kind: "location",
          latitude: l.latitude,
          longitude: l.longitude,
          name: l.name,
          address: l.address,
          mapUrl,
          title: [l.name, l.address].filter(Boolean).join(", ") || mapUrl,
          raw,
        },
      };
    }
  }
}
