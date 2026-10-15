import { z } from "zod";
import { INPUT_TYPES } from "./input-types";

/**
 * Flow definition schema. This file is shared by the editor (browser), the
 * estimator, the simulator and the server-side execution engine, so it must
 * stay free of server-only imports.
 */

export const NODE_TYPES = [
  "trigger",
  "send_message",
  "send_media",
  "wait",
  "ask_question",
  "interactive",
  "booking",
  "send_template",
  "send_location",
  "whatsapp_form",
  "notify_team",
  "set_variable",
  "add_tag",
  "api_request",
  "validation",
  "condition",
  "save_lead",
  "crm_webhook",
  "handoff",
  "end",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const LEAD_FIELDS = ["none", "name", "business_name", "service", "requirements", "email"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

const variableName = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, numbers and underscores (e.g. business_name)");

const messageText = z.string().trim().min(1, "Message text is required").max(4096);

// --- Per-node configuration ------------------------------------------------

export const triggerConfig = z.object({
  match: z.enum(["any", "keywords"]).default("any"),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  matchMode: z.enum(["contains", "exact", "starts_with"]).default("contains"),
  customerType: z.enum(["any", "new", "returning"]).default("any"),
});

export const sendMessageConfig = z.object({
  text: messageText,
  /** Do not send this message to the same contact again within this many hours (0 = always send). */
  cooldownHours: z.number().int().min(0).max(24 * 30).default(0),
  /** Optional link button under the message (WhatsApp "call to action" URL). */
  buttonText: z.string().trim().max(20).default(""),
  buttonUrl: z.string().trim().max(2000).default(""),
});

export const sendMediaConfig = z.object({
  assetId: z.uuid().nullable().default(null),
  mediaType: z.enum(["document", "image", "video"]).default("document"),
  caption: z.string().max(1024).default(""),
  filename: z.string().max(240).default(""),
  /** Do not re-send the same asset to the same contact within this many hours (0 = always send). */
  cooldownHours: z.number().int().min(0).max(24 * 30).default(24),
});

export const waitConfig = z.object({
  amount: z.number().int().min(1).max(7 * 24 * 3600),
  unit: z.enum(["seconds", "minutes", "hours"]).default("seconds"),
});

/** Minutes before the optional "No reply" branch runs (0 = off). Stays inside the 24-hour window. */
const timeoutMinutes = z.number().int().min(0).max(23 * 60).default(0);

export const askQuestionConfig = z.object({
  question: messageText,
  variable: variableName,
  leadField: z.enum(LEAD_FIELDS).default("none"),
  /** What a valid answer looks like; anything but "text" is checked and re-asked. */
  inputType: z.enum(INPUT_TYPES).default("text"),
  /** Number answers only. */
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  /** Sent when the answer doesn't fit inputType (blank = a sensible default). */
  errorMessage: z.string().max(1024).default(""),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  timeoutMinutes,
});

export const interactiveOption = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_\-.:]+$/, "Option IDs may contain letters, numbers, _ - . :"),
  title: z.string().trim().min(1).max(24, "WhatsApp limits option titles to 24 characters"),
  description: z.string().max(72).default(""),
});
export type InteractiveOption = z.infer<typeof interactiveOption>;

export const interactiveConfig = z.object({
  body: z.string().trim().min(1).max(1024),
  header: z.string().max(60).default(""),
  footer: z.string().max(60).default(""),
  /** Label of the button that opens a list message. */
  buttonText: z.string().trim().min(1).max(20).default("Choose"),
  mode: z.enum(["auto", "buttons", "list", "text"]).default("auto"),
  options: z.array(interactiveOption).min(1).max(10),
  variable: variableName,
  leadField: z.enum(LEAD_FIELDS).default("none"),
  /** "multiple": the customer ticks several options in the list and taps Done. */
  selection: z.enum(["single", "multiple"]).default("single"),
  minSelect: z.number().int().min(1).max(10).default(1),
  /** null = no upper limit. Reaching it finishes the selection. */
  maxSelect: z.number().int().min(1).max(10).nullable().default(null),
  doneText: z.string().trim().min(1).max(24).default("✅ Done"),
  timeoutMinutes,
});

export const WEEKDAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayId = (typeof WEEKDAY_IDS)[number];
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, e.g. 09:30");

export const bookingConfig = z.object({
  /** What is booked, e.g. "Site visit" or "{{vars.service}}". Shown to the team. */
  service: z.string().max(200).default(""),
  /** Bookings share free slots per calendar. */
  calendar: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9 _-]+$/, "Letters, numbers, spaces, _ and - only").default("main"),
  days: z.array(z.enum(WEEKDAY_IDS)).min(1, "Choose at least one day").default(["mon", "tue", "wed", "thu", "fri", "sat"]),
  startTime: clockTime.default("10:00"),
  endTime: clockTime.default("18:00"),
  slotMinutes: z.number().int().min(5).max(480).default(30),
  /** Bookings allowed per slot. */
  capacity: z.number().int().min(1).max(100).default(1),
  daysAhead: z.number().int().min(1).max(60).default(7),
  minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60).default(60),
  blockedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")).max(100).default([]),
  datePrompt: messageText.default("Which day suits you?"),
  timePrompt: messageText.default("What time on {{booking.date}}?"),
  confirmMessage: z.string().max(4096).default("✅ You're booked for {{vars.booking}}. See you then!"),
  noSlotsMessage: z.string().max(4096).default("Sorry, there are no free times in the next few days. Our team will contact you."),
  variable: variableName.default("booking"),
  /** 0 = no reminder. */
  reminderHours: z.number().int().min(0).max(72).default(0),
  /** Sent while the 24-hour window is open. */
  reminderMessage: z.string().max(4096).default("Reminder: your appointment is on {{vars.booking}}. Reply here if you need to change it."),
  /** Approved template used when the window has closed (blank = skip the reminder then). */
  reminderTemplate: z.string().max(512).default(""),
  reminderTemplateLanguage: z.string().max(15).default("en"),
});

export const sendTemplateConfig = z.object({
  name: z.string().trim().min(1, "Choose a template").max(512).regex(/^[a-z0-9_]+$/, "Template names use lowercase letters, numbers and _"),
  language: z.string().trim().min(2).max(15).default("en"),
  /** Values for {{1}}, {{2}}… in the template body; placeholders allowed. */
  bodyParams: z.array(z.string().max(1024)).max(20).default([]),
});

export const sendLocationConfig = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().max(100).default(""),
  address: z.string().max(300).default(""),
});

/** A WhatsApp Form (Meta "Flow") built in WhatsApp Manager, sent as a button that opens it. */
export const whatsappFormConfig = z.object({
  flowId: z.string().trim().regex(/^\d{5,30}$/, "Paste the Flow ID (a number) from WhatsApp Manager → Flows"),
  /** First screen id of the form, e.g. "QUESTION_ONE". */
  screen: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_]+$/, "Screen ids use letters, numbers and _"),
  cta: z.string().trim().min(1).max(20).default("Open form"),
  body: messageText.default("Please fill in this short form."),
  header: z.string().max(60).default(""),
  footer: z.string().max(60).default(""),
  /** Send the draft version (for testing before the form is published). */
  draft: z.boolean().default(false),
  variable: variableName.default("form"),
});

export const notifyTeamConfig = z.object({
  title: z.string().trim().min(1).max(200).default("Customer needs attention"),
  message: z.string().max(2000).default("{{contact.name|A customer}} · {{contact.phone}}"),
});

export const setVariableConfig = z.object({
  variable: variableName,
  value: z.string().max(4096).default(""),
});

const tagName = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} _-]+$/u, "Tags use letters, numbers, spaces, _ and -");
export const addTagConfig = z.object({
  tags: z.array(tagName).min(1, "Add at least one tag").max(10),
  action: z.enum(["add", "remove"]).default("add"),
});

export const apiRequestConfig = z.object({
  method: z.enum(["GET", "POST"]).default("POST"),
  /** Public https URL; placeholders allowed. */
  url: z.string().trim().min(1, "Enter a URL").max(2000),
  headers: z
    .array(z.object({ name: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9-]+$/, "Header names use letters, numbers and -"), value: z.string().max(2000) }))
    .max(10)
    .default([]),
  /** JSON body for POST; placeholders allowed. */
  body: z.string().max(10_000).default(""),
  /** The JSON reply is saved here: {{vars.api.field}}. */
  variable: variableName.default("api"),
  timeoutSeconds: z.number().int().min(1).max(15).default(8),
});

export const validationConfig = z.object({
  variable: variableName,
  required: z.boolean().default(true),
  minLength: z.number().int().min(0).max(4096).nullable().default(null),
  maxLength: z.number().int().min(1).max(4096).nullable().default(null),
  preset: z.enum(["none", "name", "email", "phone", "business_name"]).default("none"),
  pattern: z.string().max(300).default(""),
  /** When non-empty the answer must be one of these option IDs (interactive answers). */
  allowedOptionIds: z.array(z.string()).default([]),
  errorMessage: messageText,
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "is_set",
  "is_not_set",
  "matches_regex",
  "customer_is_new",
  "customer_is_returning",
  "option_selected",
  "has_open_enquiry",
  "within_business_hours",
] as const;

export const conditionConfig = z.object({
  /** Template resolved at runtime, e.g. {{vars.service.id}} or {{contact.name}}. */
  left: z.string().max(300).default(""),
  operator: z.enum(CONDITION_OPERATORS).default("equals"),
  right: z.string().max(500).default(""),
  caseSensitive: z.boolean().default(false),
});

export const saveLeadConfig = z.object({
  mapping: z
    .object({
      name: z.string().max(300).default("{{vars.name}}"),
      business_name: z.string().max(300).default("{{vars.business_name}}"),
      service: z.string().max(300).default("{{vars.service}}"),
      requirements: z.string().max(300).default("{{vars.requirements}}"),
      email: z.string().max(300).default(""),
    })
    .default({
      name: "{{vars.name}}",
      business_name: "{{vars.business_name}}",
      service: "{{vars.service}}",
      requirements: "{{vars.requirements}}",
      email: "",
    }),
  /** Fields that must be present for the lead to be marked "qualified". */
  qualifyWhen: z.array(z.enum(["name", "business_name", "service", "requirements", "email"])).default([
    "name",
    "service",
    "requirements",
  ]),
  updateContact: z.boolean().default(true),
});

export const crmWebhookConfig = z.object({
  /** null = deliver to every enabled CRM integration. */
  integrationId: z.uuid().nullable().default(null),
});

export const handoffConfig = z.object({
  message: z.string().max(4096).default("Thanks! A member of our team will reply to you here shortly."),
  reason: z.string().max(200).default("Customer requested human assistance"),
});

export const endConfig = z.object({
  outcome: z.enum(["completed"]).default("completed"),
});

export const NODE_CONFIG_SCHEMAS = {
  trigger: triggerConfig,
  send_message: sendMessageConfig,
  send_media: sendMediaConfig,
  wait: waitConfig,
  ask_question: askQuestionConfig,
  interactive: interactiveConfig,
  booking: bookingConfig,
  send_template: sendTemplateConfig,
  send_location: sendLocationConfig,
  whatsapp_form: whatsappFormConfig,
  notify_team: notifyTeamConfig,
  set_variable: setVariableConfig,
  add_tag: addTagConfig,
  api_request: apiRequestConfig,
  validation: validationConfig,
  condition: conditionConfig,
  save_lead: saveLeadConfig,
  crm_webhook: crmWebhookConfig,
  handoff: handoffConfig,
  end: endConfig,
} as const satisfies Record<NodeType, z.ZodType>;

export type NodeConfigMap = { [K in NodeType]: z.infer<(typeof NODE_CONFIG_SCHEMAS)[K]> };
export type TriggerConfig = NodeConfigMap["trigger"];
export type SendMediaConfig = NodeConfigMap["send_media"];
export type WaitConfig = NodeConfigMap["wait"];
export type InteractiveConfig = NodeConfigMap["interactive"];
export type ValidationConfig = NodeConfigMap["validation"];
export type ConditionConfig = NodeConfigMap["condition"];
export type AskQuestionConfig = NodeConfigMap["ask_question"];
export type BookingConfig = NodeConfigMap["booking"];
export type SendTemplateConfig = NodeConfigMap["send_template"];
export type SaveLeadConfig = NodeConfigMap["save_lead"];

// --- Graph -----------------------------------------------------------------

export const flowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    label: z.string().max(80).default(""),
    config: z.record(z.string(), z.unknown()),
  }),
});

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});

export const flowDefinitionSchema = z.object({
  nodes: z.array(flowNodeSchema).max(200),
  edges: z.array(flowEdgeSchema).max(400),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});

export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;

export function parseNodeConfig<T extends NodeType>(type: T, config: unknown): NodeConfigMap[T] {
  return NODE_CONFIG_SCHEMAS[type].parse(config ?? {}) as NodeConfigMap[T];
}

export function safeParseNodeConfig<T extends NodeType>(type: T, config: unknown) {
  return NODE_CONFIG_SCHEMAS[type].safeParse(config ?? {});
}

export function waitSeconds(cfg: WaitConfig): number {
  const mult = cfg.unit === "hours" ? 3600 : cfg.unit === "minutes" ? 60 : 1;
  return cfg.amount * mult;
}
