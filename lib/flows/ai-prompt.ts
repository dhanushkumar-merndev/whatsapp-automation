import { NODE_REGISTRY } from "@/lib/engine/registry";
import { NODE_TYPES } from "@/lib/engine/schema";
import { NODE_DOCS } from "./node-docs";

/**
 * The "system prompt" the owner pastes into ChatGPT before describing the
 * workflow they want. It is generated from the step registry and docs, so it
 * always matches what the import accepts, and lists the current media files and
 * CRM integrations by id.
 */

export interface AiPromptContext {
  media: { id: string; name: string; kind: string }[];
  crm: { id: string; name: string; enabled: boolean }[];
}

/** Kept small and valid: tests import it to make sure the prompt never teaches a broken format. */
export const AI_PROMPT_EXAMPLE = {
  name: "Website enquiry",
  description: "Greets the customer, asks name and service, saves the lead.",
  steps: [
    { id: "start", type: "trigger", config: { match: "any" }, next: "welcome" },
    { id: "welcome", type: "send_message", config: { text: "Hi {{contact.name|there}} 👋 Welcome to *Acme Studio*!" }, next: "pause" },
    { id: "pause", type: "wait", config: { amount: 2, unit: "seconds" }, next: "ask_name" },
    { id: "ask_name", type: "ask_question", config: { question: "May I know your name?", variable: "name", leadField: "name" }, next: "ask_service" },
    {
      id: "ask_service",
      type: "interactive",
      config: {
        body: "Thanks {{vars.name}}! Which services do you need? Tick all that apply.",
        selection: "multiple",
        options: [
          { id: "web", title: "Website" },
          { id: "ads", title: "Ads" },
          { id: "seo", title: "SEO" },
          { id: "other", title: "Something else" },
        ],
        variable: "service",
        leadField: "service",
      },
      next: "ask_email",
    },
    {
      id: "ask_email",
      type: "ask_question",
      config: { question: "What's your email address?", variable: "email", leadField: "email", inputType: "email", timeoutMinutes: 60 },
      next: { out: "save", invalid: "to_team", no_reply: "nudge" },
    },
    { id: "nudge", type: "send_message", config: { text: "Still there? Just reply with your email and we'll send the details 🙂" } },
    {
      id: "save",
      type: "save_lead",
      config: { mapping: { name: "{{vars.name}}", service: "{{vars.service}}", email: "{{vars.email}}" }, qualifyWhen: ["name", "service"] },
      next: "thanks",
    },
    { id: "thanks", type: "send_message", config: { text: "Got it ✅ Our team will contact you soon." }, next: "done" },
    { id: "done", type: "end" },
    { id: "to_team", type: "handoff", config: { message: "Let me connect you with our team.", reason: "Email not understood" } },
  ],
};

function stepReference(): string {
  return NODE_TYPES.map((type) => {
    const doc = NODE_DOCS[type];
    const outputs = NODE_REGISTRY[type].outputs.map((o) => o.id);
    const next =
      outputs.length === 0
        ? `no "next" (ends the workflow)`
        : outputs.length === 1
          ? `"next": "<step id>"`
          : `"next": { ${outputs.map((o) => `"${o}": "<step id>"`).join(", ")} }`;
    return [`### ${type} — ${doc.purpose}`, `Links: ${next}`, "Config:", ...doc.config.map((c) => `- ${c}`), ...(doc.notes ?? []).map((n) => `Note: ${n}`)].join("\n");
  }).join("\n\n");
}

export function buildAiPrompt(ctx: AiPromptContext): string {
  const media = ctx.media.length
    ? ctx.media.map((m) => `- "${m.name}" (${m.kind}): ${m.id}`).join("\n")
    : "- (none uploaded yet — use assetId null)";
  const crm = ctx.crm.filter((c) => c.enabled).length
    ? ctx.crm.filter((c) => c.enabled).map((c) => `- "${c.name}": ${c.id}`).join("\n")
    : "- (none — skip crm_webhook steps)";

  return `You design WhatsApp chatbot workflows for a business. I will describe what I need; you reply with ONE workflow as JSON that my bot imports directly. Use only the step types and fields described here.

## How the bot works
- A workflow starts only when a customer messages the business on WhatsApp. The bot never messages first.
- Steps run in order. Question steps (ask_question, interactive) wait for the customer's reply.
- Only one workflow is live at a time, so it must cope with any first message (a greeting, a question, a click from an ad).
- Built in, do not build: STOP (unsubscribe), START, HUMAN (talk to a person), 24-hour reply-window checks, spam limits.
- The team gets alerts for new leads and handoffs automatically.

## Output format
{
  "name": "Short workflow name",
  "description": "One sentence",
  "steps": [
    { "id": "start", "type": "trigger", "label": "Optional short label", "config": { ... }, "next": "welcome" },
    { "id": "check", "type": "condition", "config": { ... }, "next": { "true": "step_a", "false": "step_b" } }
  ]
}

## Rules
1. Exactly one "trigger" step, listed first.
2. "id": unique, short, readable, letters/numbers/_/- only (e.g. "ask_name").
3. "next": the id of the following step. Steps with several outputs use an object with every output name (see each step). Leave "next" out to stop after a step. "handoff" and "end" never have "next".
4. Give every branch an ending ("end" or "handoff"). Never build a loop that doesn't wait for the customer.
5. Variable names: lowercase letters, numbers and _, starting with a letter (max 40 chars).
6. Placeholders in any text: {{contact.name}}, {{contact.name|there}} (with fallback), {{contact.phone}}, {{contact.business_name}}, {{contact.email}}, {{vars.<variable>}} (an answer; for options: the chosen title), {{vars.<variable>.id}} (chosen option id), {{vars.first_message}}, {{vars.last_message}}.
7. WhatsApp limits: message ≤ 4096 chars, option title ≤ 24 (≤ 20 for buttons), option description ≤ 72, header/footer ≤ 60, list button ≤ 20, at most 10 options.
8. Write like a friendly human: short messages, WhatsApp formatting (*bold*, _italic_, line breaks as \\n), a few emojis at most.
9. Only include config fields you need; others get sensible defaults.
10. Reply with the JSON only, in one \`\`\`json code block, no comments. If something essential is unclear, first ask me up to 3 short questions instead.
11. If I send you an existing workflow JSON with changes, return the complete updated JSON and keep existing step ids.

## Step types
${stepReference()}

## Media library (for send_media.assetId)
${media}

## CRM integrations (for crm_webhook.integrationId)
${crm}

## Example
\`\`\`json
${JSON.stringify(AI_PROMPT_EXAMPLE, null, 2)}
\`\`\`

Now ask me what workflow I need (or wait for my requirement).`;
}
