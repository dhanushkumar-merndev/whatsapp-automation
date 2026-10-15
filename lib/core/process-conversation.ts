import { resumeWithInput, startExecution } from "@/lib/engine/runner";
import { selectTrigger } from "@/lib/engine/trigger";
import { isWindowOpen } from "@/lib/engine/window";
import type { ContactSnapshot, ConversationSnapshot, EngineDeps, FlowVersionRecord, InboundInput } from "@/lib/engine/types";
import type { AppStore, Limiter, PendingInbound, TriggerCandidateRecord, TurnState } from "./types";
import { NON_ACTIONABLE_TYPES } from "./webhook-ingest";

export interface PipelineDeps extends EngineDeps {
  store: AppStore;
  limiter: Limiter;
}

const LOCK_TTL_SECONDS = 60;
const BATCH = 20;
/** Meta timestamps are whole seconds, so allow one second before comparing with our clock. */
const TIMESTAMP_SLACK_MS = 1000;

const MEDIA_TYPES = new Set(["image", "document", "video", "audio", "sticker"]);
const text = (v: unknown) => (typeof v === "string" && v ? v : null);

export function toInboundInput(msg: PendingInbound): InboundInput {
  const p = msg.payload ?? {};
  const loc = (p.location ?? null) as Record<string, unknown> | null;
  return {
    type: msg.type,
    text: (msg.body ?? "").trim(),
    replyId: typeof p.reply_id === "string" ? p.reply_id : undefined,
    replyTitle: typeof p.reply_title === "string" ? p.reply_title : undefined,
    messageId: msg.waMessageId,
    ...(MEDIA_TYPES.has(msg.type)
      ? {
          media: {
            type: msg.type,
            mediaId: text(p.media_id),
            mimeType: text(p.mime_type),
            filename: text(p.filename),
            caption: msg.body && !/^\[\w+\]$/.test(msg.body) ? msg.body : null,
          },
        }
      : {}),
    ...(p.form_response && typeof p.form_response === "object" ? { form: p.form_response as Record<string, unknown> } : {}),
    ...(msg.type === "location" && loc
      ? {
          location: {
            latitude: Number(loc.latitude),
            longitude: Number(loc.longitude),
            name: text(loc.name),
            address: text(loc.address),
          },
        }
      : {}),
  };
}

function keyword(text: string) {
  return text.trim().toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Processes all pending inbound messages of one conversation, strictly in
 * order and under a per-conversation lease lock. Safe to call concurrently
 * (from multiple webhook deliveries or a finished delay job): only one caller
 * holds the lock, and the release → re-check loop guarantees no message that
 * arrived meanwhile is left unprocessed.
 */
export async function processConversation(deps: PipelineDeps, conversationId: string): Promise<{ processed: number; locked: boolean }> {
  const { store } = deps;
  const token = globalThis.crypto.randomUUID();
  let processed = 0;

  for (let round = 0; round < 5; round++) {
    const turn = await store.beginTurn(conversationId, token, LOCK_TTL_SECONDS, BATCH);
    if (!turn.locked) return { processed, locked: true };
    try {
      // The first message uses the state fetched with the lock; later ones reload it,
      // because handling a message can change it.
      let state: TurnState | null | undefined = turn.state;
      let batch = turn.pending;
      while (batch.length) {
        for (const msg of batch) {
          try {
            await handleInbound(deps, msg, state === undefined ? await store.getTurnState(conversationId) : state);
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            deps.logger.error("inbound processing failed", { conversationId, messageId: msg.id, error });
            await store.markInbound(msg.id, "failed", error.slice(0, 500));
          }
          state = undefined;
          processed++;
        }
        batch = await store.listPendingInbound(conversationId, BATCH);
      }
    } finally {
      await store.releaseLock(conversationId, token);
    }
    const again = await store.listPendingInbound(conversationId, 1);
    if (again.length === 0) break;
  }
  return { processed, locked: false };
}

async function sendSystemText(
  deps: PipelineDeps,
  conversation: ConversationSnapshot,
  contact: ContactSnapshot,
  key: string,
  text: string,
) {
  if (!text.trim() || !isWindowOpen(conversation.lastInboundAt, deps.now(), deps.settings)) return;
  const claim = await deps.store.claimOutbound({
    idempotencyKey: key,
    conversationId: conversation.id,
    contactId: contact.id,
    executionId: null,
    nodeId: null,
    message: { kind: "text", text },
    preview: text,
    mediaAssetId: null,
    isTest: conversation.isTest,
  });
  if (claim.status === "duplicate") return;
  try {
    const { waMessageId } = await deps.sender.send({
      to: contact.waId,
      phoneNumberId: conversation.phoneNumberId,
      message: { kind: "text", text },
    });
    await deps.store.completeOutbound(key, { waMessageId });
  } catch (e) {
    await deps.store.completeOutbound(key, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function stopExecution(deps: PipelineDeps, executionId: string, status: "cancelled" | "handoff", reason: string) {
  await deps.store.setExecutionStatus(executionId, status, reason);
  const qstashIds = await deps.store.cancelJobsForExecution(executionId);
  for (const id of qstashIds) {
    try {
      await deps.scheduler.cancel(id);
    } catch (e) {
      deps.logger.warn("could not cancel QStash message", { id, error: String(e) });
    }
  }
}

/**
 * Flow definitions for step 5 or 6, loaded alongside the rate-limit check.
 * Published versions are immutable and cached per instance, so this is
 * usually free.
 */
async function loadFlowData(store: AppStore, state: TurnState) {
  if (state.active) return { version: await store.getFlowVersion(state.active.flowVersionId), candidates: null };
  return { version: null, candidates: await loadCandidates(store, state) };
}

async function loadCandidates(store: AppStore, state: TurnState): Promise<TriggerCandidateRecord[]> {
  const versions = await Promise.all(state.candidates.map((c) => store.getFlowVersion(c.versionId)));
  return state.candidates.flatMap((c, i) => (versions[i] ? [{ ...c, definition: versions[i].definition }] : []));
}

const sentBefore = (msg: PendingInbound, iso: string | null | undefined) =>
  Boolean(iso) && new Date(msg.providerTimestamp).getTime() + TIMESTAMP_SLACK_MS <= new Date(iso!).getTime();

async function handleInbound(deps: PipelineDeps, msg: PendingInbound, state: TurnState | null) {
  const { store, settings } = deps;
  if (!state) {
    await store.markInbound(msg.id, "ignored", "conversation_not_found");
    return;
  }
  const { conversation, contact, active } = state;
  const now = deps.now();
  const input = toInboundInput(msg);

  if (NON_ACTIONABLE_TYPES.has(msg.type)) {
    await store.markInbound(msg.id, "ignored", `non_actionable_type:${msg.type}`);
    return;
  }

  // 1. Per-customer throttling. Runs only for signature-verified events and is
  //    keyed by the sender's WhatsApp ID — never by Meta's IP addresses.
  //    The message itself is already durably stored, so nothing is lost.
  const [rl, flow] = await Promise.all([
    deps.limiter.limit(contact.waId, {
      prefix: "inbound",
      tokens: settings.rateLimits.inboundPerMinute,
      windowSeconds: 60,
    }),
    loadFlowData(store, state),
  ]);
  if (!rl.success) {
    await store.recordSecurityEvent({ scope: "inbound_message", identifier: contact.waId, contactId: contact.id, action: "throttled" });
    const since = new Date(now.getTime() - 10 * 60_000).toISOString();
    const violations = await store.countRecentSecurityEvents("inbound_message", contact.id, since);
    if (violations >= settings.rateLimits.abuseViolationsBeforeCooldown && !contact.cooldownUntil) {
      const until = new Date(now.getTime() + settings.rateLimits.abuseCooldownMinutes * 60_000).toISOString();
      await store.updateContact(contact.id, { cooldown_until: until });
      await store.recordSecurityEvent({ scope: "abuse_cooldown", identifier: contact.waId, contactId: contact.id, action: "cooldown" });
      await store.notify({
        kind: "abuse_cooldown",
        severity: "warning",
        title: `Automation paused for +${contact.waId}`,
        body: `Too many messages in a short time. Automated replies resume after ${settings.rateLimits.abuseCooldownMinutes} minutes. Messages are still recorded.`,
        link: `/conversations/${conversation.id}`,
      });
    }
    await store.markInbound(msg.id, "rate_limited", "throttled: stored, automation skipped");
    return;
  }

  // 2. Abuse cooldown in effect.
  if (contact.cooldownUntil && new Date(contact.cooldownUntil).getTime() > now.getTime()) {
    await store.markInbound(msg.id, "rate_limited", "cooldown");
    return;
  }

  // 3. Global keywords: STOP / START / HUMAN.
  const kw = keyword(input.replyTitle ?? input.text);
  const isKw = (list: string[]) => kw.length > 0 && list.some((k) => keyword(k) === kw);

  if (isKw(settings.keywords.stop)) {
    await store.updateContact(contact.id, { opted_out: true });
    if (active) await stopExecution(deps, active.id, "cancelled", "Customer opted out (STOP)");
    await sendSystemText(deps, conversation, contact, `sys:${msg.id}:stop`, settings.messages.stopConfirmation);
    await store.markInbound(msg.id, "processed", "opted_out");
    return;
  }
  if (isKw(settings.keywords.start)) {
    if (contact.optedOut) await store.updateContact(contact.id, { opted_out: false });
    await sendSystemText(deps, conversation, contact, `sys:${msg.id}:start`, settings.messages.startConfirmation);
    await store.markInbound(msg.id, "processed", "opted_in");
    return;
  }
  if (contact.optedOut) {
    await store.markInbound(msg.id, "ignored", "contact_opted_out");
    return;
  }
  if (isKw(settings.keywords.human)) {
    if (active) await stopExecution(deps, active.id, "handoff", "Customer requested a human");
    await store.updateConversation(conversation.id, {
      status: "handoff",
      handoff_reason: "Customer requested a human",
      handoff_at: now.toISOString(),
    });
    await sendSystemText(deps, conversation, contact, `sys:${msg.id}:human`, settings.messages.handoff);
    await store.notify({
      kind: "handoff",
      severity: "warning",
      title: `Human assistance requested by +${contact.waId}`,
      body: input.text.slice(0, 200),
      link: `/conversations/${conversation.id}`,
      entityType: "conversation",
      entityId: conversation.id,
    });
    await store.markInbound(msg.id, "processed", "handoff_requested");
    return;
  }

  // A closed conversation re-opens when the customer writes again.
  if (conversation.status === "closed") {
    await store.updateConversation(conversation.id, { status: "open" });
    conversation.status = "open";
  }

  // 4. Conversation is with a human: record only, and alert the team.
  if (conversation.status === "handoff") {
    const who = contact.name ?? contact.profileName;
    await store.notify({
      kind: "handoff_message",
      severity: "info",
      title: `Message from ${who ? `${who} (+${contact.waId})` : `+${contact.waId}`}`,
      body: (input.text || input.replyTitle || "(photo, file or other non-text message)").slice(0, 500),
      link: `/conversations/${conversation.id}`,
      entityType: "conversation",
      entityId: conversation.id,
    });
    await store.markInbound(msg.id, "ignored", "conversation_in_handoff");
    return;
  }

  // 5. Resume the active execution when appropriate.
  if (active) {
    const flowStatus = state.activeFlowStatus;
    const stale = now.getTime() - new Date(active.lastActivityAt).getTime();
    // A workflow replaced by another live one is "paused" but lets open chats finish
    // (an explicit Pause stops them up front); draft / archived / missing stop here.
    if (flowStatus !== "active" && flowStatus !== "testing" && flowStatus !== "paused") {
      await stopExecution(deps, active.id, "cancelled", `Flow is ${flowStatus ?? "missing"}`);
      await store.setExecutionStatus(active.id, "paused", `Flow is ${flowStatus ?? "missing"}`);
    } else if (active.status === "waiting_input" && stale > settings.execution.resumeWithinHours * 3_600_000) {
      await store.setExecutionStatus(active.id, "abandoned", "Customer replied after the resume window");
    } else if (active.status === "waiting_input" && active.awaiting?.kind === "input" && sentBefore(msg, active.awaiting.since)) {
      // Written before the question went out (e.g. during a short wait): keep it, but it is not the answer.
      await store.markInbound(msg.id, "processed", "received_before_question", active.id);
      return;
    } else if (active.status === "waiting_input") {
      const version = flow.version;
      if (!version) throw new Error("Flow version missing for active execution");
      const exec = await resumeWithInput(deps, { execution: active, version, conversation, contact, input });
      await store.markInbound(msg.id, "processed", "answer", exec.id);
      return;
    } else if (active.status === "waiting_delay") {
      // The next step is already scheduled; replies during a delay are kept
      // in the conversation history but do not advance the flow.
      await store.markInbound(msg.id, "processed", "received_during_delay", active.id);
      return;
    } else if (stale > 5 * 60_000) {
      await store.setExecutionStatus(active.id, "failed", "Execution interrupted");
    } else {
      await store.markInbound(msg.id, "processed", "execution_running", active.id);
      return;
    }
  }

  // 6. Start a flow — only ever in response to this customer message.
  if (sentBefore(msg, state.lastCompletedAt)) {
    // Sent while the previous run was still replying: don't restart the flow for it.
    await store.markInbound(msg.id, "processed", "received_during_previous_run");
    return;
  }
  // Prefetched unless an active execution was just ended above.
  const candidates = flow.candidates ?? (await loadCandidates(store, state));
  const isNewCustomer = state.priorExecutions === 0;
  const selected = selectTrigger(candidates, input, isNewCustomer);
  if (!selected) {
    await store.markInbound(msg.id, "processed", "no_matching_flow");
    return;
  }
  const c = candidates.find((x) => x.versionId === selected.versionId)!;
  const version: FlowVersionRecord = {
    id: c.versionId,
    flowId: c.flowId,
    flowName: c.flowName,
    version: c.version,
    definition: c.definition,
  };
  const exec = await startExecution(deps, { version, conversation, contact, input, isNewCustomer });
  await store.markInbound(msg.id, "processed", exec ? "flow_started" : "execution_already_active", exec?.id ?? null);
}
