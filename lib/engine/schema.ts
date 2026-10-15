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
