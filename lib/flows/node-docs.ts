import type { NodeType } from "@/lib/engine/schema";

/**
 * Plain-language reference for every step type, used in the ChatGPT prompt.
 * Typed against NodeType so a new step type cannot be added without docs.
 */
export interface NodeDoc {
  /** One line: what the step does. */
  purpose: string;
  /** Config fields: `name` (type, default) — meaning. */
  config: string[];
  /** Extra rules worth knowing. */
  notes?: string[];
}

export const NODE_DOCS: Record<NodeType, NodeDoc> = {
  trigger: {
    purpose: "Start of the workflow. Runs when a customer sends a message. Exactly one per workflow.",
    config: [
      `match ("any" | "keywords", default "any") — "any" starts for every message; use "any" for the main workflow.`,
      `keywords (string[]) — only with match "keywords".`,
      `matchMode ("contains" | "exact" | "starts_with", default "contains").`,
      `customerType ("any" | "new" | "returning", default "any").`,
    ],
  },
  send_message: {
    purpose: "Send a text message.",
    config: [
      `text (string, required, max 4096) — supports placeholders.`,
      `cooldownHours (integer, default 0) — skip if this step already messaged the same customer within this many hours.`,
      `buttonText (string, max 20) + buttonUrl (https link, placeholders allowed) — optional link button under the message (text must be ≤ 1024 chars).`,
    ],
  },
  send_media: {
    purpose: "Send a file from the media library (brochure PDF, image or video).",
    config: [
      `assetId (string | null) — id from the media list below. Leave null if none fits (the owner can pick one later).`,
      `mediaType ("document" | "image" | "video", default "document").`,
      `caption (string, max 1024) and filename (string, documents only).`,
      `cooldownHours (integer, default 24) — don't resend the same file within this many hours.`,
    ],
  },
  wait: {
    purpose: "Pause before the next step. Up to 20 seconds feels like typing; longer waits are scheduled.",
    config: [`amount (integer ≥ 1).`, `unit ("seconds" | "minutes" | "hours", default "seconds").`],
    notes: ["Keep pauses short (2–5 seconds) between messages. Never wait longer than 23 hours: the 24-hour reply window would close."],
  },
  ask_question: {
    purpose: "Ask a question and wait for the reply, stored in a variable. Can check the answer type and re-ask.",
    config: [
      `question (string, required).`,
      `variable (string, required) — e.g. "name". Later: {{vars.name}}.`,
      `leadField ("none" | "name" | "business_name" | "service" | "requirements" | "email", default "none") — also save the answer on the lead.`,
      `inputType ("text" | "number" | "email" | "phone" | "date" | "url" | "media" | "location", default "text") — anything but "text" is checked and re-asked. "date" understands 25/10, 25 Oct, tomorrow, Monday ({{vars.x}} shows "Mon, 25 Oct 2026", {{vars.x.iso}} = 2026-10-25). "media" = a photo/file, "location" = a shared pin.`,
      `min, max (number | null) — for inputType "number".`,
      `errorMessage (string, optional) — sent when the answer doesn't fit; leave out for a friendly default.`,
      `maxAttempts (integer 1–10, default 3) — then output "invalid".`,
      `timeoutMinutes (integer 0–1380, default 0) — if > 0 and there is no reply in time, output "no_reply" runs (e.g. a reminder).`,
    ],
    notes: [
      `Outputs: "out" (answer), "invalid" (only when inputType isn't "text"; optional — if left out the flow continues with what they wrote), "no_reply" (only when timeoutMinutes > 0). With only "out", "next" can be a plain string.`,
      "Prefer inputType over separate validation steps.",
    ],
  },
  interactive: {
    purpose: "Ask the customer to pick one option (WhatsApp reply buttons or list). They can also type the number or the title.",
    config: [
      `body (string, required, max 1024) — the question.`,
      `header, footer (string, max 60, optional).`,
      `buttonText (string, max 20, default "Choose") — label of the list button.`,
      `mode ("auto" | "buttons" | "list" | "text", default "auto") — auto: ≤ 3 short options → buttons, ≤ 10 → list.`,
      `options (array, 1–10) of { id, title, description } — id: letters/numbers/_-.: (e.g. "svc_web"); title max 24 chars (max 20 for buttons); description max 72 (list only).`,
      `variable (string, required) — the answer: {{vars.x}} = chosen title(s), {{vars.x.id}} = chosen id(s), comma-separated when several.`,
      `leadField (same as ask_question).`,
      `selection ("single" | "multiple", default "single") — "multiple": the customer ticks options in the list and taps Done (max 9 options).`,
      `minSelect (integer, default 1), maxSelect (integer | null, default null = no limit) — for "multiple".`,
      `doneText (string, max 24, default "✅ Done") — the finish row for "multiple".`,
      `timeoutMinutes (integer, default 0) — if > 0, output "no_reply" runs when they don't answer in time.`,
    ],
    notes: [
      "To branch on the choice, follow with condition steps using operator option_selected (works for several choices too).",
      `Outputs: "out", plus "no_reply" only when timeoutMinutes > 0.`,
    ],
  },
  booking: {
    purpose: "Appointment booking: the customer picks a day, then a free time (WhatsApp lists). Saves the booking, alerts the team, can remind the customer.",
    config: [
      `service (string) — what is booked, e.g. "Site visit" or "{{vars.service}}".`,
      `calendar (string, default "main") — bookings share free slots per calendar.`,
      `days (array of "mon"…"sun", default Mon–Sat), startTime / endTime ("HH:MM" 24h, default "10:00"–"18:00").`,
      `slotMinutes (default 30), capacity (bookings per slot, default 1), daysAhead (default 7), minNoticeMinutes (default 60), blockedDates (["YYYY-MM-DD"]).`,
      `datePrompt, timePrompt (string; timePrompt can use {{booking.date}}), confirmMessage (sent after booking), noSlotsMessage.`,
      `variable (default "booking") — {{vars.booking}} = "Thu, 15 Oct 2026 at 10:30 AM".`,
      `reminderHours (0–72, default 0 = off), reminderMessage (text, used while the 24-hour window is open), reminderTemplate (approved template name used otherwise; its {{1}} gets the date and time), reminderTemplateLanguage (default "en").`,
    ],
    notes: [`Outputs: "booked", and "no_slots" (optional) when nothing is free.`],
  },
  send_template: {
    purpose: "Send an approved WhatsApp template (needed to message someone after 24 hours, e.g. follow-ups).",
    config: [
      `name (string, required) — the template's name exactly as approved in WhatsApp Manager (lowercase_with_underscores).`,
      `language (string, default "en") — e.g. "en", "en_US", "hi".`,
      `bodyParams (string[]) — values for {{1}}, {{2}}… in the template body; placeholders allowed.`,
    ],
    notes: ["Only use templates the business told you exist; otherwise prefer send_message."],
  },
  send_location: {
    purpose: "Send a map pin (shop, office, venue).",
    config: [`latitude, longitude (numbers, required).`, `name, address (strings, optional).`],
  },
  whatsapp_form: {
    purpose: "Open a WhatsApp Form (Meta Flow) the business built in WhatsApp Manager — for long forms with dropdowns, checkboxes, date pickers. Waits until it is submitted.",
    config: [
      `flowId (string of digits, required) — from WhatsApp Manager → Flows. Only use if the business gave you one.`,
      `screen (string, required) — the form's first screen id, e.g. "QUESTION_ONE".`,
      `cta (string, max 20, default "Open form"), body (string), header, footer (optional), draft (boolean, default false — true while testing an unpublished form).`,
      `variable (default "form") — answers by field name: {{vars.form.<field_name>}}; {{vars.form}} lists them all.`,
    ],
  },
  notify_team: {
    purpose: "Alert the business team (dashboard + Telegram) with a custom message; the workflow continues.",
    config: [`title (string), message (string; placeholders allowed).`],
  },
  set_variable: {
    purpose: "Store a value for later steps.",
    config: [`variable (string, required), value (string; placeholders allowed).`],
  },
  add_tag: {
    purpose: "Add or remove tags on the customer (e.g. \"hot lead\", \"website\"). Tags show in the dashboard; {{contact.tags}} lists them.",
    config: [`tags (string[], 1–10, letters/numbers/spaces).`, `action ("add" | "remove", default "add").`],
  },
  api_request: {
    purpose: "Call another system's API and save the JSON reply. Outputs “success” (2xx) or “error”.",
    config: [
      `method ("GET" | "POST", default "POST"), url (public https URL; placeholders are URL-encoded).`,
      `headers (array of { name, value }), body (JSON text for POST; placeholders are JSON-escaped).`,
      `variable (default "api") — reply fields: {{vars.api.<field>}}; {{vars.api.status}} is the HTTP status.`,
      `timeoutSeconds (1–15, default 8).`,
    ],
    notes: ["Only add this if the business gave you the API details."],
  },
  validation: {
    purpose: "Advanced: extra checks (length, regex, allowed options) on the answer to the question right before it. Invalid → re-asks with errorMessage; after maxAttempts → output “invalid”.",
    config: [
      `variable (string, required) — same variable as the question.`,
      `required (boolean, default true).`,
      `minLength, maxLength (integer | null).`,
      `preset ("none" | "name" | "email" | "phone" | "business_name", default "none").`,
      `pattern (string regex, optional).`,
      `allowedOptionIds (string[]) — for interactive answers, allow only these option ids.`,
      `errorMessage (string, required) — sent when the answer is invalid.`,
      `maxAttempts (integer 1–10, default 3).`,
    ],
  },
  condition: {
    purpose: "Branch: output “true” or “false”.",
    config: [
      `left (string) — usually a placeholder, e.g. "{{vars.service.id}}" or "{{contact.name}}".`,
      `operator — one of: equals, not_equals, contains, not_contains, is_set, is_not_set, matches_regex, customer_is_new, customer_is_returning, option_selected (left = "{{vars.x.id}}", right = option id), has_open_enquiry (right = optional number of days), within_business_hours (true while the business is open, per Settings).`,
      `right (string) — value to compare with.`,
      `caseSensitive (boolean, default false).`,
    ],
  },
  save_lead: {
    purpose: "Create or update the lead (enquiry) from the answers. The team gets a “New lead” alert.",
    config: [
      `mapping (object) — name, business_name, service, requirements, email: each a placeholder, e.g. { "name": "{{vars.name}}", "service": "{{vars.service}}" }.`,
      `qualifyWhen (array of field names, default ["name","service","requirements"]) — lead is “qualified” when these are filled.`,
      `updateContact (boolean, default true) — remember name/business/email for next time.`,
    ],
  },
  crm_webhook: {
    purpose: "Send the saved lead to the CRM (only after save_lead).",
    config: [`integrationId (string | null, default null) — null sends to every enabled CRM integration.`],
  },
  handoff: {
    purpose: "Hand the chat to a person: the bot stops for this customer and the team is alerted. Ends the workflow.",
    config: [`message (string) — sent to the customer.`, `reason (string) — shown to the team.`],
  },
  end: {
    purpose: "End the workflow.",
    config: [`outcome ("completed").`],
  },
};
