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
    purpose: "Ask a free-text question and wait for the reply. The answer is stored in a variable.",
    config: [
      `question (string, required).`,
      `variable (string, required) — e.g. "name". Later: {{vars.name}}.`,
      `leadField ("none" | "name" | "business_name" | "service" | "requirements" | "email", default "none") — also save the answer on the lead.`,
    ],
    notes: ["To check the answer (e.g. a valid email), put a validation step directly after it."],
  },
  interactive: {
    purpose: "Ask the customer to pick one option (WhatsApp reply buttons or list). They can also type the number or the title.",
    config: [
      `body (string, required, max 1024) — the question.`,
      `header, footer (string, max 60, optional).`,
      `buttonText (string, max 20, default "Choose") — label of the list button.`,
      `mode ("auto" | "buttons" | "list" | "text", default "auto") — auto: ≤ 3 short options → buttons, ≤ 10 → list.`,
      `options (array, 1–10) of { id, title, description } — id: letters/numbers/_-.: (e.g. "svc_web"); title max 24 chars (max 20 for buttons); description max 72 (list only).`,
      `variable (string, required) — the answer: {{vars.x}} = chosen title, {{vars.x.id}} = chosen id.`,
      `leadField (same as ask_question).`,
    ],
    notes: ["To branch on the choice, follow with condition steps using operator option_selected."],
  },
  validation: {
    purpose: "Check the answer to the question right before it. Invalid → re-asks with errorMessage; after maxAttempts → output “invalid”.",
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
      `operator — one of: equals, not_equals, contains, not_contains, is_set, is_not_set, matches_regex, customer_is_new, customer_is_returning, option_selected (left = "{{vars.x.id}}", right = option id), has_open_enquiry (right = optional number of days).`,
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
