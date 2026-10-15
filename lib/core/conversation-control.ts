import { startExecution } from "@/lib/engine/runner";
import { isWindowOpen } from "@/lib/engine/window";
import type { IngestResult } from "./webhook-ingest";
import { processConversation, stopExecution, type PipelineDeps } from "./process-conversation";

/**
 * Who handles a chat: the bot or a person. Shared by the dashboard buttons,
 * Telegram action buttons, auto hand-back and the WhatsApp Business app
 * takeover (coexistence), so they all behave the same.
 */

export type ChatAction = "bot_on" | "restart" | "human" | "close";
export type ChatActor = "team" | "telegram" | "business_app" | "customer" | "flow";

export const CHAT_ACTION_LABELS: Record<ChatAction, string> = {
  bot_on: "Bot on",
  restart: "Flow restarted",
  human: "Kept with a person",
  close: "Closed",
};

export interface ChatActionResult {
  ok: boolean;
  /** Plain-language outcome, shown in the dashboard toast or the Telegram alert. */
  message: string;
}

/**
 * Applies one action to a chat. "restart" also starts the live workflow right
 * away (inside the 24-hour window), using the customer's last message.
 */
export async function applyChatAction(deps: PipelineDeps, conversationId: string, action: ChatAction, actor: ChatActor): Promise<ChatActionResult> {
  const { store } = deps;
  const state = await store.getTurnState(conversationId);
  if (!state) return { ok: false, message: "Conversation not found." };
  const now = deps.now().toISOString();

  if (action === "human" || action === "close") {
    if (state.active) await stopExecution(deps, state.active.id, action === "human" ? "handoff" : "cancelled", action === "human" ? "Taken over by a person" : "Conversation closed");
    await store.updateConversation(
      conversationId,
      action === "human"
        ? { status: "handoff", handoff_reason: "Taken over by a person", handoff_at: now, handoff_by: actor }
        : { status: "closed" },
    );
    return { ok: true, message: action === "human" ? "The bot is paused for this chat." : "Conversation closed." };
  }

  await store.updateConversation(conversationId, { status: "open", handoff_reason: null, handoff_by: null });
  if (action === "bot_on") return { ok: true, message: "The bot will answer the customer's next message." };

  // Restart now: start the live workflow without waiting for the customer.
  const { conversation, contact } = state;
  if (contact.optedOut) return { ok: false, message: "The bot is on, but the customer opted out (STOP), so nothing was sent." };
  if (!isWindowOpen(conversation.lastInboundAt, deps.now(), deps.settings)) {
    return { ok: false, message: "The bot is on, but the 24-hour window has closed, so the flow starts when the customer writes again." };
  }
  const candidate = state.candidates.find((c) => c.status === "active") ?? state.candidates[0];
  if (!candidate) return { ok: false, message: "The bot is on, but no workflow is live." };
  const version = await store.getFlowVersion(candidate.versionId);
  if (!version) return { ok: false, message: "The live workflow could not be loaded." };
  const token = globalThis.crypto.randomUUID();
  if (!(await store.acquireLock(conversationId, token, 60))) return { ok: false, message: "The bot is busy with this chat; it is on and will answer next time." };
  try {
    const fresh = (await store.getTurnState(conversationId)) ?? state;
    if (fresh.active) await stopExecution(deps, fresh.active.id, "cancelled", "Restarted");
    const input = { type: "text", text: "" };
    const exec = await startExecution(deps, { version, conversation: { ...fresh.conversation, status: "open" }, contact: fresh.contact, input, isNewCustomer: fresh.priorExecutions === 0 });
    return exec ? { ok: true, message: `“${version.flowName}” restarted for this customer.` } : { ok: false, message: "The bot is on; the flow could not be restarted." };
  } finally {
    await store.releaseLock(conversationId, token);
  }
}

/**
 * The business replied from the WhatsApp Business app: stop the bot in that
 * chat (the database already marked it as handed off) and alert the team.
 */
export async function handleTakeover(deps: PipelineDeps, conversationId: string) {
  const state = await deps.store.getTurnState(conversationId);
  if (!state) return;
  if (state.active) await stopExecution(deps, state.active.id, "handoff", "You replied from the WhatsApp Business app");
  const who = state.contact.name ?? state.contact.profileName;
  await deps.store.notify({
    kind: "handoff_app",
    severity: "info",
    title: `You're chatting with ${who ? `${who} (+${state.contact.waId})` : `+${state.contact.waId}`} — bot paused`,
    body: "You replied from the WhatsApp Business app, so the bot stopped in this chat. Turn it back on when you're done.",
    link: `/conversations/${conversationId}`,
    entityType: "conversation",
    entityId: conversationId,
    conversationId,
  });
}

/** Everything after a webhook was recorded: phone-app takeovers first, then customer messages. */
export async function processIngested(deps: PipelineDeps, result: IngestResult, onError?: (conversationId: string, e: unknown) => void) {
  for (const id of result.takeovers) {
    try {
      await handleTakeover(deps, id);
    } catch (e) {
      onError?.(id, e);
    }
  }
  for (const id of result.conversations) {
    try {
      await processConversation(deps, id);
    } catch (e) {
      onError?.(id, e);
    }
  }
}
