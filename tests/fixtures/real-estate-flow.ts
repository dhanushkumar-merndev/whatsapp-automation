import type { FlowDefinition, FlowEdge, FlowNode, NodeType } from "@/lib/engine/schema";

/**
 * "Real estate — Facebook ad questions" flow. Facebook click-to-WhatsApp ads
 * pre-fill one of four questions; this flow answers any of them after a short
 * pause, asks whether the prospect wants to talk to the team, and on "Yes"
 * collects name + business name as a lead. Plain greetings like "Hi" do not
 * match the keywords, so they still go to the main enquiry flow.
 */

export const REAL_ESTATE_FLOW_NAME = "Real Estate — Facebook ad questions";
export const REAL_ESTATE_FLOW_DESCRIPTION =
  "Answers the 4 Facebook ad questions after 5 seconds, offers a call with the team, and on Yes collects name and business name as a lead.";
/** Lower than the main enquiry flow (100) so these questions are always caught here first. */
export const REAL_ESTATE_FLOW_PRIORITY = 10;

/**
 * Distinctive phrases from the ad questions (matched case-insensitively as whole
 * words inside the message):
 *  1. Will you generate leads, handle calls, and convert prospects into site visit bookings?
 *  2. How do you follow up with leads and schedule site visits?
 *  3. Can you handle a high volume of enquiries for our real estate project?
 *  4. How do you track lead status and keep us updated on conversions and site visit bookings?
 */
export const REAL_ESTATE_KEYWORDS = [
  "generate leads",
  "site visit",
  "site visits",
  "site visit bookings",
  "follow up with leads",
  "high volume of enquiries",
  "real estate project",
  "track lead status",
];

const DISCUSS_YES = "discuss_yes";
const DISCUSS_NO = "discuss_no";

function node(id: string, type: NodeType, label: string, x: number, y: number, config: Record<string, unknown>): FlowNode {
  return { id, type, position: { x, y }, data: { label, config } };
}

function edge(source: string, target: string, sourceHandle = "out"): FlowEdge {
  return { id: `e_${source}_${sourceHandle}_${target}`, source, target, sourceHandle };
}

export function buildRealEstateFlowDefinition(): FlowDefinition {
  const step = 160;
  const YES = -190;
  const NO = 190;
  const nodes: FlowNode[] = [
    node("re_trigger", "trigger", "Facebook ad question", 0, 0, {
      match: "keywords",
      keywords: REAL_ESTATE_KEYWORDS,
      matchMode: "contains",
      customerType: "any",
    }),
    node("re_wait", "wait", "Pause 5 seconds", 0, step, { amount: 5, unit: "seconds" }),
    node("re_answer", "interactive", "Answer + offer a call", 0, step * 2, {
      body:
        "Great question! 🏡✨\n\n" +
        "Yes — at *Star Growth Hub* we take care of the whole journey for real estate projects:\n\n" +
        "✅ Targeted Meta & Google ads that bring genuine buyer enquiries\n" +
        "✅ Quick follow-up on every lead by call and WhatsApp\n" +
        "✅ Turning interested prospects into confirmed site visit bookings\n" +
        "✅ Clear lead tracking with regular updates on conversions and visits\n\n" +
        "Would you like to discuss your project with our team? 🤝",
      header: "",
      footer: "Tap a button, or reply 1 or 2",
      buttonText: "Choose",
      mode: "buttons",
      options: [
        { id: DISCUSS_YES, title: "Yes 👍", description: "" },
        { id: DISCUSS_NO, title: "No 🙏", description: "" },
      ],
      variable: "discuss",
      leadField: "none",
    }),
    node("re_check_answer", "validation", "Check Yes / No", 0, step * 3, {
      variable: "discuss",
      required: true,
      minLength: null,
      maxLength: null,
      preset: "none",
      pattern: "",
      allowedOptionIds: [DISCUSS_YES, DISCUSS_NO],
      errorMessage: "Please tap *Yes* or *No* above, or reply 1 or 2 🙂",
      maxAttempts: 2,
    }),
    node("re_wants_call", "condition", "Wants to talk?", 0, step * 4, {
      left: "{{vars.discuss.id}}",
      operator: "option_selected",
      right: DISCUSS_YES,
      caseSensitive: false,
    }),

    // Yes → collect the lead
    node("re_ask_name", "ask_question", "Ask name", YES, step * 5, {
      question: "Wonderful! 😊 May I know your name, please?",
      variable: "name",
      leadField: "name",
    }),
    node("re_check_name", "validation", "Check name", YES, step * 6, {
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
    node("re_ask_business", "ask_question", "Ask business name", YES, step * 7, {
      question: "Thanks, {{vars.name}}! 🙌 What's your business or company name?",
      variable: "business_name",
      leadField: "business_name",
    }),
    node("re_save", "save_lead", "Save lead", YES, step * 8, {
      mapping: {
        name: "{{vars.name}}",
        business_name: "{{vars.business_name}}",
        service: "Real Estate Lead Generation",
        requirements: "{{vars.first_message}}",
        email: "",
      },
      qualifyWhen: ["name", "business_name"],
      updateContact: true,
    }),
    node("re_crm", "crm_webhook", "Send to CRM", YES, step * 9, { integrationId: null }),
    node("re_thanks", "send_message", "Thank you", YES, step * 10, {
      text:
        "Thank you, {{vars.name}}! 🎉\n\n" +
        "We've noted your details for *{{vars.business_name}}*. Our real estate growth team will contact you shortly " +
        "to plan more quality leads and site visits for your project. 🏡📈",
      cooldownHours: 0,
    }),
    node("re_end_yes", "end", "Lead captured", YES, step * 11, { outcome: "completed" }),

    // No → polite close
    node("re_no_thanks", "send_message", "No problem", NO, step * 5, {
      text:
        "No problem at all! 😊 Thank you for your interest in *Star Growth Hub*.\n\n" +
        "Whenever you're ready to fill your project with quality leads and site visits, just message us here. Have a great day! 🙏",
      cooldownHours: 0,
    }),
    node("re_end_no", "end", "Not interested now", NO, step * 6, { outcome: "completed" }),

    // Replies we couldn't understand → a person takes over
    node("re_handoff", "handoff", "Team takes over", NO + 380, step * 5, {
      message: "Let me connect you with our team — someone will reply to you here shortly. 🙂",
      reason: "Real estate ad enquiry: customer replied with something the bot could not understand",
    }),
  ];

  const edges: FlowEdge[] = [
    edge("re_trigger", "re_wait"),
    edge("re_wait", "re_answer"),
    edge("re_answer", "re_check_answer"),
    edge("re_check_answer", "re_wants_call", "valid"),
    edge("re_check_answer", "re_handoff", "invalid"),
    edge("re_wants_call", "re_ask_name", "true"),
    edge("re_wants_call", "re_no_thanks", "false"),
    edge("re_ask_name", "re_check_name"),
    edge("re_check_name", "re_ask_business", "valid"),
    edge("re_check_name", "re_handoff", "invalid"),
    edge("re_ask_business", "re_save"),
    edge("re_save", "re_crm"),
    edge("re_crm", "re_thanks"),
    edge("re_thanks", "re_end_yes"),
    edge("re_no_thanks", "re_end_no"),
  ];

  return { nodes, edges };
}
