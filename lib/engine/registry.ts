import type { NodeConfigMap, NodeType } from "./schema";

export type NodeCategory = "trigger" | "messaging" | "input" | "logic" | "data" | "control";

export interface NodeOutput {
  id: string;
  label: string;
}

export interface NodeDefinition<T extends NodeType = NodeType> {
  type: T;
  label: string;
  description: string;
  category: NodeCategory;
  /** Tailwind-compatible accent colour (hex) used by the canvas and palette. */
  color: string;
  hasInput: boolean;
  outputs: NodeOutput[];
  /** Whether the node sends at least one WhatsApp message when executed. */
  sends: boolean;
  /** Whether the node pauses execution for a customer reply. */
  waitsForInput: boolean;
  defaults: () => NodeConfigMap[T];
  /** Only one node of this type is allowed per flow. */
  singleton?: boolean;
}

const OUT: NodeOutput[] = [{ id: "out", label: "Next" }];

export const NODE_REGISTRY: { [K in NodeType]: NodeDefinition<K> } = {
  trigger: {
    type: "trigger",
    label: "Customer message",
    description: "Starts the flow when a customer messages your WhatsApp number. Never sends first.",
    category: "trigger",
    color: "#16a34a",
    hasInput: false,
    outputs: OUT,
    sends: false,
    waitsForInput: false,
    singleton: true,
    defaults: () => ({ match: "any", keywords: [], matchMode: "contains", customerType: "any" }),
  },
  send_message: {
    type: "send_message",
    label: "Send message",
    description: "Reply with text. Supports variables like {{contact.name}}.",
    category: "messaging",
    color: "#2563eb",
    hasInput: true,
    outputs: OUT,
    sends: true,
    waitsForInput: false,
    defaults: () => ({ text: "Hello {{contact.name|there}}!", cooldownHours: 0 }),
  },
  send_media: {
    type: "send_media",
    label: "Send media",
    description: "Send a brochure, image or video from the media library.",
    category: "messaging",
    color: "#0891b2",
    hasInput: true,
    outputs: OUT,
    sends: true,
    waitsForInput: false,
    defaults: () => ({ assetId: null, mediaType: "document", caption: "", filename: "", cooldownHours: 24 }),
  },
  wait: {
    type: "wait",
    label: "Wait",
    description: "Pause before the next step. Short waits show “typing…”; long ones are scheduled.",
    category: "control",
    color: "#d97706",
    hasInput: true,
    outputs: OUT,
    sends: false,
    waitsForInput: false,
    defaults: () => ({ amount: 5, unit: "seconds" }),
  },
  ask_question: {
    type: "ask_question",
    label: "Ask question",
    description: "Ask for free text and store the reply in a variable.",
    category: "input",
    color: "#7c3aed",
    hasInput: true,
    outputs: OUT,
    sends: true,
    waitsForInput: true,
    defaults: () => ({ question: "May I know your name, please?", variable: "name", leadField: "name" }),
  },
  interactive: {
    type: "interactive",
    label: "Interactive selection",
    description: "Reply buttons or a list, with a numbered text fallback.",
    category: "input",
    color: "#9333ea",
    hasInput: true,
    outputs: OUT,
    sends: true,
    waitsForInput: true,
    defaults: () => ({
      body: "Please choose an option:",
      header: "",
      footer: "",
      buttonText: "Choose",
      mode: "auto",
      options: [
        { id: "opt_1", title: "Option 1", description: "" },
        { id: "opt_2", title: "Option 2", description: "" },
      ],
      variable: "choice",
      leadField: "none",
    }),
  },
  validation: {
    type: "validation",
    label: "Validate answer",
    description: "Check the last answer. Re-asks with an error message, then takes the Failed branch.",
    category: "logic",
    color: "#db2777",
    hasInput: true,
    outputs: [
      { id: "valid", label: "Valid" },
      { id: "invalid", label: "Failed" },
    ],
    sends: false,
    waitsForInput: false,
    defaults: () => ({
      variable: "name",
      required: true,
      minLength: 2,
      maxLength: 80,
      preset: "none",
      pattern: "",
      allowedOptionIds: [],
      errorMessage: "Sorry, I didn't catch that. Could you try again?",
      maxAttempts: 3,
    }),
  },
  condition: {
    type: "condition",
    label: "Condition",
    description: "Branch on a variable, keyword, customer type or selected option.",
    category: "logic",
    color: "#ea580c",
    hasInput: true,
    outputs: [
      { id: "true", label: "Yes" },
      { id: "false", label: "No" },
    ],
    sends: false,
    waitsForInput: false,
    defaults: () => ({ left: "{{vars.choice.id}}", operator: "equals", right: "", caseSensitive: false }),
  },
  save_lead: {
    type: "save_lead",
    label: "Save lead",
    description: "Create or update the lead from collected answers.",
    category: "data",
    color: "#059669",
    hasInput: true,
    outputs: OUT,
    sends: false,
    waitsForInput: false,
    defaults: () => ({
      mapping: {
        name: "{{vars.name}}",
        business_name: "{{vars.business_name}}",
        service: "{{vars.service}}",
        requirements: "{{vars.requirements}}",
        email: "",
      },
      qualifyWhen: ["name", "service", "requirements"],
      updateContact: true,
    }),
  },
  crm_webhook: {
    type: "crm_webhook",
    label: "Send to CRM",
    description: "Deliver the saved lead to your CRM webhook with retries.",
    category: "data",
    color: "#4f46e5",
    hasInput: true,
    outputs: OUT,
    sends: false,
    waitsForInput: false,
    defaults: () => ({ integrationId: null }),
  },
  handoff: {
    type: "handoff",
    label: "Human handoff",
    description: "Stop automation and flag the conversation for your team.",
    category: "control",
    color: "#dc2626",
    hasInput: true,
    outputs: [],
    sends: true,
    waitsForInput: false,
    defaults: () => ({
      message: "Thanks! A member of our team will reply to you here shortly.",
      reason: "Customer requested human assistance",
    }),
  },
  end: {
    type: "end",
    label: "End flow",
    description: "Mark the flow as completed.",
    category: "control",
    color: "#475569",
    hasInput: true,
    outputs: [],
    sends: false,
    waitsForInput: false,
    defaults: () => ({ outcome: "completed" }),
  },
};

export const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: "Trigger",
  messaging: "Messaging",
  input: "Customer input",
  logic: "Logic",
  data: "Data & CRM",
  control: "Flow control",
};

export function nodeDef(type: NodeType): NodeDefinition {
  return NODE_REGISTRY[type] as unknown as NodeDefinition;
}
