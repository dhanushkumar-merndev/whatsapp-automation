import type { FlowDefinition, FlowEdge, FlowNode, NodeType } from "@/lib/engine/schema";

/**
 * Test fixture: the original Star Growth Hub enquiry flow. Workflows are now
 * created in the builder or imported from JSON; this copy keeps the engine
 * tests exercising a realistic flow.
 */

export const STAR_SERVICES = [
  { id: "svc_digital_marketing", title: "Digital Marketing", description: "" },
  { id: "svc_social_media", title: "Social Media Management", description: "" },
  { id: "svc_ads", title: "Meta & Google Ads", description: "" },
  { id: "svc_video", title: "Video Production", description: "" },
  { id: "svc_branding", title: "Branding & Creative", description: "Branding & Creative Services" },
  { id: "svc_other", title: "Other Services", description: "" },
];

function node(id: string, type: NodeType, label: string, x: number, y: number, config: Record<string, unknown>): FlowNode {
  return { id, type, position: { x, y }, data: { label, config } };
}

function edge(source: string, target: string, sourceHandle = "out"): FlowEdge {
  return { id: `e_${source}_${sourceHandle}_${target}`, source, target, sourceHandle };
}

export function buildDefaultFlowDefinition(brochureAssetId: string | null = null): FlowDefinition {
  const X = 0;
  const step = 150;
  const nodes: FlowNode[] = [
    node("n_trigger", "trigger", "Customer sends a message", X, 0, {
      match: "any",
      keywords: [],
      matchMode: "contains",
      customerType: "any",
    }),
    node("n_open_check", "condition", "Already submitted?", X, step, {
      left: "",
      operator: "has_open_enquiry",
      right: "30",
      caseSensitive: false,
    }),
    node("n_open_notice", "send_message", "Request already received", X + 420, step * 2, {
      text: "Hi {{contact.name|there}}! We have already received your request. Our team will contact you soon.\n\nNeed help urgently? Reply HUMAN to chat with our team.",
      cooldownHours: 12,
    }),
    node("n_open_end", "end", "Already submitted", X + 420, step * 3, { outcome: "completed" }),
    node("n_welcome", "send_message", "Welcome message", X, step * 2, {
      text:
        "Welcome to Star Growth Hub!\n\nWe help businesses grow through Digital Marketing, Social Media Management, Advertising and Creative Production.\n\nHere is our company brochure.",
    }),
    node("n_brochure", "send_media", "Company brochure", X, step * 3, {
      assetId: brochureAssetId,
      mediaType: "document",
      caption: "Star Growth Hub — Company Brochure",
      filename: "Star-Growth-Hub-Brochure.pdf",
      cooldownHours: 24,
    }),
    node("n_wait", "wait", "Wait 5 seconds", X, step * 4, { amount: 5, unit: "seconds" }),
    node("n_known", "condition", "Name already known?", X, step * 5, {
      left: "{{contact.name}}",
      operator: "is_set",
      right: "",
      caseSensitive: false,
    }),
    node("n_welcome_back", "send_message", "Welcome back", X + 360, step * 6, {
      text: "Good to see you again, {{contact.name}}!",
    }),
    node("n_ask_name", "ask_question", "Ask name", X - 360, step * 6, {
      question: "May I know your name, please?",
      variable: "name",
      leadField: "name",
    }),
    node("n_validate_name", "validation", "Validate name", X - 360, step * 7, {
      variable: "name",
      required: true,
      minLength: 2,
      maxLength: 60,
      preset: "name",
      pattern: "",
      allowedOptionIds: [],
      errorMessage: "Sorry, I didn't catch that. Please share your name (letters only).",
      maxAttempts: 3,
    }),
    node("n_service", "interactive", "Ask service", X, step * 8, {
      body: "Which service are you looking for?",
      header: "",
      footer: "Or reply with a number from 1 to 6",
      buttonText: "View services",
      mode: "auto",
      options: STAR_SERVICES,
      variable: "service",
      leadField: "service",
    }),
    node("n_validate_service", "validation", "Validate selection", X, step * 9, {
      variable: "service",
      required: true,
      minLength: null,
      maxLength: null,
      preset: "none",
      pattern: "",
      allowedOptionIds: STAR_SERVICES.map((s) => s.id),
      errorMessage: "Sorry, that's not a valid option. Please select a number from 1 to 6.",
      maxAttempts: 3,
    }),
    node("n_ask_business", "ask_question", "Ask business name", X, step * 10, {
      question: "Could you share your business name?",
      variable: "business_name",
      leadField: "business_name",
    }),
    node("n_ask_requirements", "ask_question", "Ask requirements", X, step * 11, {
      question: "Please tell us briefly what you're looking to achieve.",
      variable: "requirements",
      leadField: "requirements",
    }),
    node("n_save", "save_lead", "Save lead", X, step * 12, {
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
    node("n_crm", "crm_webhook", "Send to CRM", X, step * 13, { integrationId: null }),
    node("n_confirm", "send_message", "Confirmation", X, step * 14, {
      text: "Thank you for sharing your details. Our team will review your requirements and get in touch with you.",
    }),
    node("n_end", "end", "Completed", X, step * 15, { outcome: "completed" }),
    node("n_handoff", "handoff", "Offer human assistance", X + 420, step * 10, {
      message: "No problem — let me connect you with our team. Someone will reply to you here shortly.",
      reason: "Customer could not complete the automated questions",
    }),
  ];

  const edges: FlowEdge[] = [
    edge("n_trigger", "n_open_check"),
    edge("n_open_check", "n_open_notice", "true"),
    edge("n_open_check", "n_welcome", "false"),
    edge("n_open_notice", "n_open_end"),
    edge("n_welcome", "n_brochure"),
    edge("n_brochure", "n_wait"),
    edge("n_wait", "n_known"),
    edge("n_known", "n_welcome_back", "true"),
    edge("n_known", "n_ask_name", "false"),
    edge("n_welcome_back", "n_service"),
    edge("n_ask_name", "n_validate_name"),
    edge("n_validate_name", "n_service", "valid"),
    edge("n_validate_name", "n_handoff", "invalid"),
    edge("n_service", "n_validate_service"),
    edge("n_validate_service", "n_ask_business", "valid"),
    edge("n_validate_service", "n_handoff", "invalid"),
    edge("n_ask_business", "n_ask_requirements"),
    edge("n_ask_requirements", "n_save"),
    edge("n_save", "n_crm"),
    edge("n_crm", "n_confirm"),
    edge("n_confirm", "n_end"),
  ];

  return { nodes, edges };
}

export const DEFAULT_FLOW_NAME = "Star Growth Hub — Enquiry";
export const DEFAULT_FLOW_DESCRIPTION =
  "Already-submitted check, welcome + brochure, 5-second delay, name, service selection with validation, business name, requirements, lead capture and CRM sync.";
