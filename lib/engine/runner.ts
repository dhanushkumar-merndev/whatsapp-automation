import { FlowGraph } from "./graph";
import { applyMultiReply, buildInteractiveMessage, buildMultiMessage, isMultiAnswer, matchOption } from "./interactive";
import { DEFAULT_INPUT_ERRORS, parseAnswer } from "./input-types";
import {
  availableDays,
  bookingWindow,
  dateListMessage,
  parseBookingReply,
  timeLabel,
  timeListMessage,
  whenLabel,
  type BookingAnswer,
  type BookingState,
} from "./booking";
import { parseNodeConfig, waitSeconds, type BookingConfig, type ConditionConfig, type FlowNode, type LeadField } from "./schema";
import { renderTemplate, stringify, templateVariables, lookup, type TemplateScope } from "./template";
import { isOptionAnswer, validateAnswer } from "./validate-answer";
import { isWindowOpen } from "./window";
import { attemptCrmDelivery } from "./crm-attempt";
import { buildCrmPayload, leadSubmittedEventId } from "./crm-payload";
import {
  SendError,
  type ContactSnapshot,
  type ConversationSnapshot,
  type EngineDeps,
  type ExecutionContext,
  type ExecutionRecord,
  type ExecutionStatus,
  type FlowVersionRecord,
  type InboundInput,
  type LeadPatch,
  type NodeRunStatus,
  type OutboundMessage,
} from "./types";

interface RunContext {
  deps: EngineDeps;
  graph: FlowGraph;
  version: FlowVersionRecord;
  conversation: ConversationSnapshot;
  contact: ContactSnapshot;
  exec: ExecutionRecord;
  /** The customer message being answered; "typing…" is shown on it during short waits. */
  replyTo: string | null;
  /** One-off line added to the next multiple-choice re-ask (e.g. "Choose at least 2"). */
  notice?: string;
}

type NodeResult =
  | { type: "next"; handle: string; status?: NodeRunStatus; detail?: Record<string, unknown> }
  | { type: "wait"; detail?: Record<string, unknown> }
  | {
      type: "stop";
      status: ExecutionStatus;
      nodeStatus: NodeRunStatus;
      detail?: Record<string, unknown>;
      error?: string;
    };

const TERMINAL: ExecutionStatus[] = ["completed", "handoff", "window_expired", "failed", "cancelled", "abandoned"];
const MAX_PATH = 200;

export function emptyContext(isNewCustomer: boolean): ExecutionContext {
  return { vars: {}, attempts: {}, lastQuestionNodeId: null, isNewCustomer, leadId: null, path: [] };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Start a new execution for an inbound customer message. Returns null if another execution is active. */
export async function startExecution(
  deps: EngineDeps,
  args: {
    version: FlowVersionRecord;
    conversation: ConversationSnapshot;
    contact: ContactSnapshot;
    input: InboundInput;
    isNewCustomer: boolean;
  },
): Promise<ExecutionRecord | null> {
  const graph = new FlowGraph(args.version.definition);
  const trigger = graph.trigger();
  if (!trigger) return null;
  const context = emptyContext(args.isNewCustomer);
  context.vars.first_message = args.input.text;
  context.vars.last_message = args.input.text;
  const exec = await deps.store.createExecution({
    flowId: args.version.flowId,
    flowVersionId: args.version.id,
    conversationId: args.conversation.id,
    contactId: args.contact.id,
    isTest: args.conversation.isTest,
    context,
    currentNodeId: trigger.id,
  });
  if (!exec) return null;
  const ctx: RunContext = {
    deps,
    graph,
    version: args.version,
    conversation: args.conversation,
    contact: { ...args.contact },
    exec,
    replyTo: args.input.messageId ?? null,
  };
  await run(ctx, trigger.id);
  return ctx.exec;
}

/** Feed a customer reply into an execution that is waiting for input. */
export async function resumeWithInput(
  deps: EngineDeps,
  args: {
    execution: ExecutionRecord;
    version: FlowVersionRecord;
    conversation: ConversationSnapshot;
    contact: ContactSnapshot;
    input: InboundInput;
  },
): Promise<ExecutionRecord> {
  const exec = args.execution;
  const awaiting = exec.awaiting;
  if (exec.status !== "waiting_input" || !awaiting || awaiting.kind !== "input") return exec;

  const graph = new FlowGraph(args.version.definition);
  const ctx: RunContext = {
    deps,
    graph,
    version: args.version,
    conversation: args.conversation,
    contact: { ...args.contact },
    exec,
    replyTo: args.input.messageId ?? null,
  };
  const question = graph.get(awaiting.questionNodeId);
  const consumer = graph.get(awaiting.nodeId);
  if (!question || !consumer) {
    await finish(ctx, "failed", "The awaited node no longer exists in this flow version");
    return exec;
  }

  await cancelTimeout(ctx, awaiting.timeoutJobId);
  exec.context.vars.last_message = args.input.text;
  exec.status = "running";
  exec.awaiting = null;
  await deps.store.logNode({
    executionId: exec.id,
    nodeId: question.id,
    nodeType: question.type,
    step: exec.step,
    status: "success",
    outputHandle: null,
    detail: { event: "answer_received", preview: args.input.text.slice(0, 120) },
  });

  if (consumer.id !== question.id) {
    // A Validate step is re-asking: it checks the new answer.
    storeAnswer(ctx, question, args.input);
    await run(ctx, consumer.id);
    return ctx.exec;
  }

  if (question.type === "booking") {
    await handleBookingReply(ctx, question, args.input);
    return ctx.exec;
  }

  if (question.type === "interactive") {
    const cfg = parseNodeConfig("interactive", question.data.config);
    if (cfg.selection === "multiple") {
      const r = applyMultiReply(cfg, exec.context.vars[cfg.variable], args.input);
      exec.context.vars[cfg.variable] = r.answer;
      if (!r.done) {
        // Ask again with the picks ticked (runs the question step once more).
        ctx.notice = r.notice;
        await run(ctx, question.id);
        return ctx.exec;
      }
    } else {
      storeAnswer(ctx, question, args.input);
    }
  } else if (question.type === "ask_question") {
    const cfg = parseNodeConfig("ask_question", question.data.config);
    if (cfg.inputType === "text") {
      storeAnswer(ctx, question, args.input);
    } else {
      const parsed = parseAnswer(cfg.inputType, args.input, {
        timezone: deps.settings.business.timezone,
        now: deps.now(),
        min: cfg.min,
        max: cfg.max,
      });
      if (!parsed.ok) {
        const attempts = (exec.context.attempts[question.id] ?? 0) + 1;
        exec.context.attempts[question.id] = attempts;
        if (attempts < cfg.maxAttempts) {
          const since = deps.now().toISOString();
          const text = renderTemplate(cfg.errorMessage.trim() || DEFAULT_INPUT_ERRORS[cfg.inputType], scope(ctx));
          const sent = await sendOutbound(ctx, question, { kind: "text", text }, `retry${attempts}`);
          if (sent === "window_closed") {
            await finish(ctx, "window_expired");
            return ctx.exec;
          }
          await waitForAnswer(ctx, question.id, question.id, since);
          exec.lastActivityAt = deps.now().toISOString();
          await deps.store.saveExecution(exec);
          return ctx.exec;
        }
        // Out of tries: keep what they wrote and take the Failed branch (or carry on).
        exec.context.attempts[question.id] = 0;
        exec.context.vars[cfg.variable] = (args.input.replyTitle ?? args.input.text ?? "").trim().slice(0, 4096);
        const failed = graph.next(question.id, "invalid");
        if (failed) {
          await run(ctx, failed);
          return ctx.exec;
        }
      } else {
        exec.context.attempts[question.id] = 0;
        exec.context.vars[cfg.variable] = parsed.value;
      }
    }
  }

  const nextId = graph.next(question.id, "out");
  if (!nextId || graph.get(nextId)?.type !== "validation") await commitAnswerToLead(ctx, question);
  await run(ctx, nextId);
  return ctx.exec;
}

/** Runs the question's "No reply" branch when its timer fires and the customer still hasn't answered. */
export async function resumeAfterTimeout(
  deps: EngineDeps,
  args: {
    execution: ExecutionRecord;
    version: FlowVersionRecord;
    conversation: ConversationSnapshot;
    contact: ContactSnapshot;
    jobId: string;
  },
): Promise<{ execution: ExecutionRecord; resumed: boolean }> {
  const exec = args.execution;
  const awaiting = exec.awaiting;
  if (exec.status !== "waiting_input" || awaiting?.kind !== "input" || awaiting.timeoutJobId !== args.jobId) {
    return { execution: exec, resumed: false };
  }
  const graph = new FlowGraph(args.version.definition);
  const next = graph.next(awaiting.questionNodeId, "no_reply");
  if (!next) return { execution: exec, resumed: false };
  const ctx: RunContext = {
    deps,
    graph,
    version: args.version,
    conversation: args.conversation,
    contact: { ...args.contact },
    exec,
    replyTo: null,
  };
  exec.status = "running";
  exec.awaiting = null;
  await deps.store.logNode({
    executionId: exec.id,
    nodeId: awaiting.questionNodeId,
    nodeType: graph.get(awaiting.questionNodeId)?.type ?? "ask_question",
    step: exec.step,
    status: "success",
    outputHandle: "no_reply",
    detail: { event: "no_reply" },
  });
  await run(ctx, next);
  return { execution: ctx.exec, resumed: true };
}

/** Continue after a Wait node once its QStash job fires. */
export async function resumeAfterDelay(
  deps: EngineDeps,
  args: {
    execution: ExecutionRecord;
    version: FlowVersionRecord;
    conversation: ConversationSnapshot;
    contact: ContactSnapshot;
    jobId: string | null;
  },
): Promise<{ execution: ExecutionRecord; resumed: boolean }> {
  const exec = args.execution;
  const awaiting = exec.awaiting;
  if (exec.status !== "waiting_delay" || !awaiting || awaiting.kind !== "delay") {
    return { execution: exec, resumed: false };
  }
  if (args.jobId && awaiting.jobId && awaiting.jobId !== args.jobId) return { execution: exec, resumed: false };

  const graph = new FlowGraph(args.version.definition);
  const ctx: RunContext = {
    deps,
    graph,
    version: args.version,
    conversation: args.conversation,
    contact: { ...args.contact },
    exec,
    replyTo: null,
  };
  exec.status = "running";
  exec.awaiting = null;
  await deps.store.logNode({
    executionId: exec.id,
    nodeId: awaiting.nodeId,
    nodeType: "wait",
    step: exec.step,
    status: "success",
    outputHandle: "out",
    detail: { event: "delay_elapsed" },
  });
  await run(ctx, graph.next(awaiting.nodeId, "out"));
  return { execution: ctx.exec, resumed: true };
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

async function run(ctx: RunContext, startId: string | null) {
  const { deps, exec, graph } = ctx;
  let nodeId = startId;
  let steps = 0;
  if (!nodeId) {
    await finish(ctx, "completed");
    return;
  }

  while (nodeId) {
    const node = graph.get(nodeId);
    if (!node) {
      await finish(ctx, "failed", `Node ${nodeId} not found`);
      return;
    }
    if (++steps > deps.settings.execution.maxStepsPerRun) {
      await finish(ctx, "failed", "Loop guard: too many steps without waiting for the customer");
      return;
    }

    exec.currentNodeId = node.id;
    exec.step += 1;
    exec.status = "running";
    exec.context.path = [...exec.context.path, node.id].slice(-MAX_PATH);

    const t0 = Date.now();
    let result: NodeResult;
    try {
      result = await executeNode(ctx, node);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      deps.logger.error("node failed", { executionId: exec.id, nodeId: node.id, error: message });
      result = { type: "stop", status: "failed", nodeStatus: "failed", error: message };
    }

    await deps.store.logNode({
      executionId: exec.id,
      nodeId: node.id,
      nodeType: node.type,
      step: exec.step,
      status: result.type === "next" ? (result.status ?? "success") : result.type === "wait" ? "waiting" : result.nodeStatus,
      outputHandle: result.type === "next" ? result.handle : null,
      detail: result.detail,
      error: result.type === "stop" ? (result.error ?? null) : null,
      durationMs: Date.now() - t0,
    });
    exec.lastActivityAt = deps.now().toISOString();

    if (result.type === "next") {
      const nextId = graph.next(node.id, result.handle);
      if (!nextId) {
        await finish(ctx, "completed");
        return;
      }
      await deps.store.saveExecution(exec);
      nodeId = nextId;
      continue;
    }
    if (result.type === "wait") {
      await deps.store.saveExecution(exec);
      return;
    }
    await finish(ctx, result.status, result.error);
    return;
  }
}

async function finish(ctx: RunContext, status: ExecutionStatus, error?: string) {
  const { exec, deps } = ctx;
  exec.status = status;
  exec.awaiting = null;
  exec.error = error ?? null;
  if (TERMINAL.includes(status)) exec.completedAt = deps.now().toISOString();
  exec.lastActivityAt = deps.now().toISOString();
  await deps.store.saveExecution(exec);

  if (status === "failed") {
    await deps.store.notify({
      kind: "automation_error",
      severity: "critical",
      title: `Automation error in "${ctx.version.flowName}"`,
      body: error ?? "Unknown error",
      link: `/logs?execution=${exec.id}`,
      entityType: "flow_execution",
      entityId: exec.id,
    });
  } else if (status === "window_expired") {
    await deps.store.notify({
      kind: "window_expired",
      severity: "warning",
      title: "WhatsApp service window expired",
      body: `A pending automated reply for +${ctx.contact.waId} was not sent because the 24-hour customer service window closed. The customer must message again before automation can continue.`,
      link: `/conversations/${ctx.conversation.id}`,
      entityType: "conversation",
      entityId: ctx.conversation.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Node handlers
// ---------------------------------------------------------------------------

function scope(ctx: RunContext): TemplateScope {
  return {
    contact: {
      name: ctx.contact.name,
      profile_name: ctx.contact.profileName,
      phone: `+${ctx.contact.waId}`,
      business_name: ctx.contact.businessName,
      email: ctx.contact.email,
      is_new: ctx.exec.context.isNewCustomer,
      has_open_enquiry: ctx.contact.openEnquiryAt !== null,
    },
    vars: ctx.exec.context.vars,
    lead: { id: ctx.exec.context.leadId },
    flow: { name: ctx.version.flowName },
  };
}

function preview(message: OutboundMessage): string {
  switch (message.kind) {
    case "text":
      return message.text;
    case "media":
      return `[${message.mediaType}] ${message.caption ?? ""}`.trim();
    case "buttons":
      return `${message.body}\n${message.buttons.map((b) => `[${b.title}]`).join(" ")}`;
    case "list":
      return `${message.body}\n${message.rows.map((r, i) => `${i + 1}. ${r.title}`).join("\n")}`;
    case "template":
      return `[template ${message.name}]${message.bodyParams.length ? ` ${message.bodyParams.join(" · ")}` : ""}`;
  }
}

type SendOutcome = "sent" | "duplicate" | "window_closed";

async function sendOutbound(ctx: RunContext, node: FlowNode, message: OutboundMessage, suffix = ""): Promise<SendOutcome> {
  const { deps, exec, conversation, contact } = ctx;
  // Templates are the one kind of message WhatsApp allows after the 24-hour window.
  if (message.kind !== "template" && !isWindowOpen(conversation.lastInboundAt, deps.now(), deps.settings)) return "window_closed";

  const key = `${exec.id}:${exec.step}:${node.id}${suffix ? `:${suffix}` : ""}`;
  const asset = message.kind === "media" ? await deps.store.getMediaAsset(message.assetId) : null;
  const claim = await deps.store.claimOutbound({
    idempotencyKey: key,
    conversationId: conversation.id,
    contactId: contact.id,
    executionId: exec.id,
    nodeId: node.id,
    message,
    preview: preview(message).slice(0, 4096),
    mediaAssetId: asset?.id ?? null,
    isTest: exec.isTest,
  });
  if (claim.status === "duplicate") {
    deps.logger.warn("duplicate outbound suppressed", { key, existingStatus: claim.existingStatus });
    return "duplicate";
  }

  try {
    const { waMessageId } = await deps.sender.send({
      to: contact.waId,
      phoneNumberId: conversation.phoneNumberId,
      message,
      asset,
    });
    await deps.store.completeOutbound(key, { waMessageId });
    return "sent";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await deps.store.completeOutbound(key, { error: msg });
    if (e instanceof SendError && e.opts.windowClosed) return "window_closed";
    throw e;
  }
}

/**
 * Puts the execution in waiting_input for `questionNodeId` and, when that
 * question has a connected "No reply" branch, schedules its timer.
 */
async function waitForAnswer(ctx: RunContext, nodeId: string, questionNodeId: string, since: string) {
  const { deps, exec, graph } = ctx;
  exec.status = "waiting_input";
  let timeoutJobId: string | null = null;
  const question = graph.get(questionNodeId);
  const minutes = Number((question?.data.config as { timeoutMinutes?: number } | undefined)?.timeoutMinutes ?? 0);
  if (question && minutes > 0 && graph.next(question.id, "no_reply")) {
    const runAt = new Date(deps.now().getTime() + minutes * 60_000).toISOString();
    const { job, created } = await deps.store.createScheduledJob({
      kind: "input_timeout",
      executionId: exec.id,
      conversationId: ctx.conversation.id,
      nodeId: question.id,
      crmDeliveryId: null,
      flowId: exec.flowId,
      runAt,
      idempotencyKey: `${exec.id}:${question.id}:timeout:${since}`,
      isTest: exec.isTest,
    });
    if (created) {
      const { messageId } = await deps.scheduler.schedule({ jobId: job.id, delaySeconds: minutes * 60 });
      await deps.store.attachJobMessage(job.id, messageId);
    }
    timeoutJobId = job.id;
  }
  exec.awaiting = { kind: "input", nodeId, questionNodeId, since, timeoutJobId };
}

const bookingStateKey = (nodeId: string) => `__booking_${nodeId}`;

async function loadBookingDays(ctx: RunContext, cfg: BookingConfig) {
  const { deps } = ctx;
  const timezone = deps.settings.business.timezone;
  const now = deps.now();
  const { from, to } = bookingWindow(cfg, timezone, now);
  const taken = await deps.store.countBookings({ calendar: cfg.calendar, fromIso: from, toIso: to });
  return availableDays(cfg, { timezone, now, taken });
}

/** One reply during a booking: pick a day, page through times, pick a time (which books it). */
async function handleBookingReply(ctx: RunContext, node: FlowNode, input: InboundInput) {
  const { deps, exec, graph } = ctx;
  const cfg = parseNodeConfig("booking", node.data.config);
  const key = bookingStateKey(node.id);
  const timezone = deps.settings.business.timezone;
  const state = (exec.context.vars[key] as BookingState | undefined) ?? { stage: "date" };
  const days = await loadBookingDays(ctx, cfg);
  const day = state.stage === "time" ? days.find((d) => d.date === state.date) : undefined;
  const offset = state.offset ?? 0;
  const reply = parseBookingReply(state, input, {
    timezone,
    now: deps.now(),
    days: days.slice(0, 10).map((d) => d.date),
    times: day ? day.slots.slice(offset, offset + 8).map((s) => s.time) : [],
  });
  const askAgain = async (next: BookingState, notice?: string) => {
    exec.context.vars[key] = next;
    ctx.notice = notice;
    await run(ctx, node.id);
  };

  switch (reply.kind) {
    case "date":
      if (!days.some((d) => d.date === reply.date)) return askAgain({ stage: "date" }, "That day has no free times. Please pick a day from the list.");
      return askAgain({ stage: "time", date: reply.date, offset: 0 });
    case "page":
      return askAgain({ ...state, offset: reply.offset });
    case "back":
      return askAgain({ stage: "date" });
    case "unknown":
      return askAgain(state, state.stage === "date" ? "Please pick a day from the list." : "Please pick a time from the list.");
  }

  if (!day) return askAgain({ stage: "date" }, "Please pick a day first.");
  const slot = day.slots.find((x) => x.time === reply.time);
  if (!slot) return askAgain(state, `${timeLabel(reply.time)} isn't free on that day. Please pick a time from the list.`);

  const when = whenLabel(slot.date, slot.time);
  const answer: BookingAnswer = { kind: "booking", id: "", date: slot.date, time: slot.time, startsAt: slot.startsAt, endsAt: slot.endsAt, title: when, raw: input.text };
  exec.context.vars[cfg.variable] = answer;
  const s = scope(ctx);
  const booked = await deps.store.createBooking({
    calendar: cfg.calendar,
    capacity: cfg.capacity,
    execution: exec,
    nodeId: node.id,
    conversation: ctx.conversation,
    contact: ctx.contact,
    service: renderTemplate(cfg.service, s).trim() || null,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    timezone,
    reminder:
      cfg.reminderHours > 0
        ? { text: renderTemplate(cfg.reminderMessage, s), template: cfg.reminderTemplate, language: cfg.reminderTemplateLanguage, params: [when] }
        : null,
  });
  if (!booked.ok) {
    delete exec.context.vars[cfg.variable];
    return askAgain(state, "Sorry, that time was just taken. Please pick another one.");
  }
  answer.id = booked.id;
  delete exec.context.vars[key];

  const remindAt = new Date(slot.startsAt).getTime() - cfg.reminderHours * 3_600_000;
  if (cfg.reminderHours > 0 && remindAt > deps.now().getTime() + 60_000) {
    const { job, created } = await deps.store.createScheduledJob({
      kind: "booking_reminder",
      executionId: exec.id,
      conversationId: ctx.conversation.id,
      nodeId: node.id,
      crmDeliveryId: null,
      flowId: exec.flowId,
      bookingId: booked.id,
      runAt: new Date(remindAt).toISOString(),
      idempotencyKey: `reminder:${booked.id}`,
      isTest: exec.isTest,
    });
    if (created) {
      const { messageId } = await deps.scheduler.schedule({ jobId: job.id, delaySeconds: Math.round((remindAt - deps.now().getTime()) / 1000) });
      await deps.store.attachJobMessage(job.id, messageId);
    }
  }

  const who = ctx.contact.name ?? ctx.contact.profileName;
  const service = renderTemplate(cfg.service, s).trim();
  await deps.store.notify({
    kind: "booking_created",
    severity: "info",
    title: `${exec.isTest ? "[Test] " : ""}New booking: ${who ?? `+${ctx.contact.waId}`}`,
    body: [`When: ${when}`, service && `For: ${service}`, `Phone: +${ctx.contact.waId}`].filter(Boolean).join("\n"),
    link: "/bookings",
    entityType: "booking",
    entityId: booked.id,
  });
  if (cfg.confirmMessage.trim()) {
    const sent = await sendOutbound(ctx, node, { kind: "text", text: renderTemplate(cfg.confirmMessage, scope(ctx)) }, "confirm");
    if (sent === "window_closed") deps.logger.warn("booking confirmation not sent: window closed", { executionId: exec.id });
  }
  await run(ctx, graph.next(node.id, "booked"));
}

/** The customer answered: their "No reply" timer is no longer needed. */
async function cancelTimeout(ctx: RunContext, jobId: string | null | undefined) {
  if (!jobId) return;
  const qstashId = await ctx.deps.store.cancelScheduledJob(jobId);
  if (!qstashId) return;
  try {
    await ctx.deps.scheduler.cancel(qstashId);
  } catch (e) {
    ctx.deps.logger.warn("could not cancel QStash message", { qstashId, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Re-shows "typing…" on the customer's message. Best effort: never fails the step. */
async function showTyping(ctx: RunContext) {
  const { sender } = ctx.deps;
  if (!ctx.replyTo || !sender.markRead || ctx.deps.mode !== "live") return;
  try {
    await sender.markRead({ phoneNumberId: ctx.conversation.phoneNumberId, waMessageId: ctx.replyTo });
  } catch (e) {
    ctx.deps.logger.warn("typing indicator failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

function windowStop(): NodeResult {
  return { type: "stop", status: "window_expired", nodeStatus: "skipped", detail: { reason: "service_window_closed" } };
}

async function executeNode(ctx: RunContext, node: FlowNode): Promise<NodeResult> {
  const { deps, exec } = ctx;
  switch (node.type) {
    case "trigger":
      return { type: "next", handle: "out" };

    case "send_message": {
      const cfg = parseNodeConfig("send_message", node.data.config);
      if (cfg.cooldownHours > 0) {
        const since = new Date(deps.now().getTime() - cfg.cooldownHours * 3_600_000).toISOString();
        if (await deps.store.hasRecentNodeSend(ctx.contact.id, exec.flowId, node.id, since)) {
          return { type: "next", handle: "out", status: "skipped", detail: { reason: "cooldown", cooldownHours: cfg.cooldownHours } };
        }
      }
      const text = renderTemplate(cfg.text, scope(ctx));
      const outcome = await sendOutbound(ctx, node, { kind: "text", text });
      if (outcome === "window_closed") return windowStop();
      return { type: "next", handle: "out", detail: { outcome } };
    }

    case "send_media": {
      const cfg = parseNodeConfig("send_media", node.data.config);
      if (!cfg.assetId) return { type: "next", handle: "out", status: "skipped", detail: { reason: "no_asset_configured" } };
      const asset = await deps.store.getMediaAsset(cfg.assetId);
      if (!asset || asset.deletedAt || asset.status !== "ready") {
        await deps.store.notify({
          kind: "media_missing",
          severity: "warning",
          title: `Media for "${node.data.label || "Send media"}" is unavailable`,
          body: `Flow "${ctx.version.flowName}" skipped a media message because the selected file is missing or not ready.`,
          link: `/media`,
        });
        return { type: "next", handle: "out", status: "skipped", detail: { reason: "asset_unavailable" } };
      }
      if (cfg.cooldownHours > 0) {
        const since = new Date(deps.now().getTime() - cfg.cooldownHours * 3_600_000).toISOString();
        if (await deps.store.hasRecentMediaSend(ctx.contact.id, asset.id, since)) {
          return { type: "next", handle: "out", status: "skipped", detail: { reason: "cooldown", cooldownHours: cfg.cooldownHours } };
        }
      }
      const outcome = await sendOutbound(ctx, node, {
        kind: "media",
        mediaType: asset.kind,
        assetId: asset.id,
        caption: renderTemplate(cfg.caption, scope(ctx)) || undefined,
        filename: cfg.filename || asset.name,
      });
      if (outcome === "window_closed") return windowStop();
      return { type: "next", handle: "out", detail: { outcome, assetId: asset.id } };
    }

    case "wait": {
      const cfg = parseNodeConfig("wait", node.data.config);
      const seconds = waitSeconds(cfg);
      const inline = deps.inlineWait;
      if (inline && seconds <= deps.settings.execution.inlineWaitMaxSeconds && seconds * 1000 <= inline.budgetMs) {
        // Short pause inside this request: no QStash round trip, and "typing…" shows meanwhile.
        inline.budgetMs -= seconds * 1000;
        await Promise.all([inline.sleep(seconds * 1000), showTyping(ctx)]);
        return { type: "next", handle: "out", detail: { delaySeconds: seconds, inline: true } };
      }
      const jobsSoFar = Number(exec.context.vars.__jobs ?? 0);
      if (jobsSoFar >= deps.settings.rateLimits.scheduledJobsPerExecution) {
        return {
          type: "stop",
          status: "failed",
          nodeStatus: "failed",
          error: "Too many scheduled delays in one execution (possible loop)",
        };
      }
      const runAt = new Date(deps.now().getTime() + seconds * 1000).toISOString();
      const { job, created } = await deps.store.createScheduledJob({
        kind: "flow_resume",
        executionId: exec.id,
        conversationId: ctx.conversation.id,
        nodeId: node.id,
        crmDeliveryId: null,
        flowId: exec.flowId,
        runAt,
        idempotencyKey: `${exec.id}:${exec.step}:${node.id}`,
        isTest: exec.isTest,
      });
      if (created) {
        exec.context.vars.__jobs = jobsSoFar + 1;
        const { messageId } = await deps.scheduler.schedule({ jobId: job.id, delaySeconds: seconds });
        await deps.store.attachJobMessage(job.id, messageId);
      }
      exec.status = "waiting_delay";
      exec.awaiting = { kind: "delay", nodeId: node.id, jobId: job.id };
      return { type: "wait", detail: { delaySeconds: seconds, jobId: job.id, runAt } };
    }

    case "ask_question": {
      const cfg = parseNodeConfig("ask_question", node.data.config);
      const since = deps.now().toISOString();
      const outcome = await sendOutbound(ctx, node, { kind: "text", text: renderTemplate(cfg.question, scope(ctx)) });
      if (outcome === "window_closed") return windowStop();
      exec.context.lastQuestionNodeId = node.id;
      await waitForAnswer(ctx, node.id, node.id, since);
      return { type: "wait", detail: { outcome, variable: cfg.variable, inputType: cfg.inputType } };
    }

    case "interactive": {
      const cfg = parseNodeConfig("interactive", node.data.config);
      const since = deps.now().toISOString();
      const multiple = cfg.selection === "multiple";
      // A fresh ask starts with nothing ticked; a re-ask keeps the picks so far.
      const current = exec.context.vars[cfg.variable];
      if (multiple && (!isMultiAnswer(current) || current.done)) delete exec.context.vars[cfg.variable];
      const picks = exec.context.vars[cfg.variable];
      const message = multiple
        ? buildMultiMessage(cfg, scope(ctx), isMultiAnswer(picks) ? picks.ids : [], ctx.notice)
        : buildInteractiveMessage(cfg, scope(ctx));
      ctx.notice = undefined;
      const outcome = await sendOutbound(ctx, node, message);
      if (outcome === "window_closed") return windowStop();
      exec.context.lastQuestionNodeId = node.id;
      await waitForAnswer(ctx, node.id, node.id, since);
      return { type: "wait", detail: { outcome, variable: cfg.variable, ...(multiple ? { multiple } : {}) } };
    }

    case "send_template": {
      const cfg = parseNodeConfig("send_template", node.data.config);
      const s = scope(ctx);
      const outcome = await sendOutbound(ctx, node, {
        kind: "template",
        name: cfg.name,
        language: cfg.language,
        bodyParams: cfg.bodyParams.map((p) => renderTemplate(p, s).trim() || "-"),
      });
      return { type: "next", handle: "out", detail: { outcome, template: cfg.name } };
    }

    case "booking": {
      const cfg = parseNodeConfig("booking", node.data.config);
      const key = bookingStateKey(node.id);
      const days = await loadBookingDays(ctx, cfg);
      if (!days.length) {
        delete exec.context.vars[key];
        if (cfg.noSlotsMessage.trim()) {
          const sent = await sendOutbound(ctx, node, { kind: "text", text: renderTemplate(cfg.noSlotsMessage, scope(ctx)) });
          if (sent === "window_closed") return windowStop();
        }
        return { type: "next", handle: "no_slots", detail: { reason: "no_free_slots" } };
      }
      let state = (exec.context.vars[key] as BookingState | undefined) ?? { stage: "date" };
      const day = state.stage === "time" ? days.find((d) => d.date === state.date) : undefined;
      if (state.stage === "time" && !day) {
        state = { stage: "date" };
        ctx.notice ??= "That day is now full. Please pick another day.";
      }
      exec.context.vars[key] = state;
      const since = deps.now().toISOString();
      const message =
        state.stage === "time" && day
          ? timeListMessage(cfg, day.date, day.slots, state.offset ?? 0, scope(ctx), ctx.notice)
          : dateListMessage(cfg, days, scope(ctx), ctx.notice);
      ctx.notice = undefined;
      const outcome = await sendOutbound(ctx, node, message);
      if (outcome === "window_closed") return windowStop();
      exec.context.lastQuestionNodeId = node.id;
      await waitForAnswer(ctx, node.id, node.id, since);
      return { type: "wait", detail: { outcome, stage: state.stage, freeDays: days.length } };
    }

    case "validation": {
      const cfg = parseNodeConfig("validation", node.data.config);
      const value = exec.context.vars[cfg.variable];
      const outcome = validateAnswer(cfg, value);
      if (outcome.valid) {
        exec.context.attempts[node.id] = 0;
        const q = ctx.graph.get(exec.context.lastQuestionNodeId);
        if (q) await commitAnswerToLead(ctx, q);
        return { type: "next", handle: "valid" };
      }
      const attempts = (exec.context.attempts[node.id] ?? 0) + 1;
      exec.context.attempts[node.id] = attempts;
      const questionNodeId = exec.context.lastQuestionNodeId;
      if (attempts >= cfg.maxAttempts || !questionNodeId) {
        return { type: "next", handle: "invalid", detail: { reason: outcome.reason, attempts, exhausted: true } };
      }
      const since = deps.now().toISOString();
      const sent = await sendOutbound(ctx, node, { kind: "text", text: renderTemplate(cfg.errorMessage, scope(ctx)) }, `retry${attempts}`);
      if (sent === "window_closed") return windowStop();
      await waitForAnswer(ctx, node.id, questionNodeId, since);
      return { type: "wait", detail: { reason: outcome.reason, attempts, maxAttempts: cfg.maxAttempts } };
    }

    case "condition": {
      const cfg = parseNodeConfig("condition", node.data.config);
      const result = evaluateCondition(ctx, cfg);
      return { type: "next", handle: result ? "true" : "false", detail: { result } };
    }

    case "save_lead": {
      const cfg = parseNodeConfig("save_lead", node.data.config);
      const s = scope(ctx);
      const patch: LeadPatch = {};
      for (const field of ["name", "business_name", "service", "requirements", "email"] as const) {
        const value = renderTemplate(cfg.mapping[field] ?? "", s).trim();
        if (value) patch[field] = value.slice(0, 2000);
      }
      // Returning customers may skip questions; fall back to what we already know.
      patch.name ??= ctx.contact.name ?? undefined;
      patch.business_name ??= ctx.contact.businessName ?? undefined;
      patch.email ??= ctx.contact.email ?? undefined;
      const serviceVar = templateVariables(cfg.mapping.service ?? "")[0];
      if (serviceVar) {
        const raw = lookup(s, serviceVar.replace(/\.(title|id|raw)$/, ""));
        if (isOptionAnswer(raw) && raw.matched) patch.service_id = raw.id;
      }
      const qualified = cfg.qualifyWhen.every((f) => Boolean(patch[f]));
      patch.status = qualified ? "qualified" : "new";
      const lead = await deps.store.upsertLead({ execution: exec, conversation: ctx.conversation, contact: ctx.contact, patch });
      exec.context.leadId = lead.id;
      const details: [string, string | null | undefined][] = [
        ["Phone", `+${ctx.contact.waId}`],
        ["Service", patch.service],
        ["Business", patch.business_name],
        ["Email", patch.email],
        ["Requirements", patch.requirements],
      ];
      await deps.store.notify({
        kind: "lead_submitted",
        severity: "info",
        title: `${ctx.conversation.isTest ? "[Test] " : ""}New lead: ${patch.name ?? `+${ctx.contact.waId}`}`,
        body: details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n"),
        link: `/leads/${lead.id}`,
        entityType: "lead",
        entityId: lead.id,
      });
      if (cfg.updateContact) {
        const contactPatch: { name?: string; business_name?: string; email?: string } = {};
        if (patch.name) contactPatch.name = patch.name;
        if (patch.business_name) contactPatch.business_name = patch.business_name;
        if (patch.email) contactPatch.email = patch.email;
        if (Object.keys(contactPatch).length) {
          await deps.store.updateContact(ctx.contact.id, contactPatch);
          if (contactPatch.name) ctx.contact.name = contactPatch.name;
          if (contactPatch.business_name) ctx.contact.businessName = contactPatch.business_name;
          if (contactPatch.email) ctx.contact.email = contactPatch.email;
        }
      }
      return { type: "next", handle: "out", detail: { leadId: lead.id, status: lead.status } };
    }

    case "crm_webhook": {
      const cfg = parseNodeConfig("crm_webhook", node.data.config);
      const leadId = exec.context.leadId;
      if (!leadId) return { type: "next", handle: "out", status: "skipped", detail: { reason: "no_lead_saved" } };
      const lead = await deps.store.getLead(leadId);
      if (!lead) return { type: "next", handle: "out", status: "skipped", detail: { reason: "lead_not_found" } };
      const integrations = await deps.store.listCrmIntegrations({ enabledOnly: true, id: cfg.integrationId });
      if (integrations.length === 0) {
        await deps.store.setLeadCrmStatus(lead.id, "not_configured");
        return { type: "next", handle: "out", status: "skipped", detail: { reason: "no_enabled_integration" } };
      }
      const results: Record<string, string> = {};
      for (const integration of integrations) {
        const eventId = leadSubmittedEventId(lead.id);
        const payload = buildCrmPayload({
          lead,
          eventId,
          eventType: "lead.submitted",
          mapping: integration.fieldMapping,
          occurredAt: deps.now().toISOString(),
        });
        const { delivery, created } = await deps.store.createCrmDelivery({
          integrationId: integration.id,
          leadId: lead.id,
          eventId,
          eventType: "lead.submitted",
          payload,
          isTest: exec.isTest,
        });
        if (!created && delivery.status !== "pending") {
          results[integration.id] = `existing:${delivery.status}`;
          continue;
        }
        results[integration.id] = await attemptCrmDelivery(deps, integration, delivery);
      }
      return { type: "next", handle: "out", detail: { results } };
    }

    case "handoff": {
      const cfg = parseNodeConfig("handoff", node.data.config);
      const now = deps.now().toISOString();
      if (cfg.message.trim()) {
        const outcome = await sendOutbound(ctx, node, { kind: "text", text: renderTemplate(cfg.message, scope(ctx)) });
        if (outcome === "window_closed") deps.logger.warn("handoff message not sent: window closed", { executionId: exec.id });
      }
      await deps.store.updateConversation(ctx.conversation.id, { status: "handoff", handoff_reason: cfg.reason, handoff_at: now });
      await deps.store.notify({
        kind: "handoff",
        severity: "warning",
        title: `Human assistance needed for +${ctx.contact.waId}`,
        body: cfg.reason,
        link: `/conversations/${ctx.conversation.id}`,
        entityType: "conversation",
        entityId: ctx.conversation.id,
      });
      return { type: "stop", status: "handoff", nodeStatus: "success", detail: { reason: cfg.reason } };
    }

    case "end":
      return { type: "stop", status: "completed", nodeStatus: "success" };
  }
}

function evaluateCondition(ctx: RunContext, cfg: ConditionConfig): boolean {
  const s = scope(ctx);
  switch (cfg.operator) {
    case "customer_is_new":
      return ctx.exec.context.isNewCustomer;
    case "customer_is_returning":
      return !ctx.exec.context.isNewCustomer;
    case "has_open_enquiry": {
      // "Compare with" holds an optional look-back in days; blank means any open enquiry counts.
      if (!ctx.contact.openEnquiryAt) return false;
      const days = Number(cfg.right.trim());
      if (!cfg.right.trim() || !Number.isFinite(days) || days <= 0) return true;
      return ctx.deps.now().getTime() - new Date(ctx.contact.openEnquiryAt).getTime() <= days * 86_400_000;
    }
    case "is_set":
      return renderTemplate(cfg.left, s).trim().length > 0;
    case "is_not_set":
      return renderTemplate(cfg.left, s).trim().length === 0;
  }
  const left = renderTemplate(cfg.left, s);
  const right = renderTemplate(cfg.right, s);
  const l = cfg.caseSensitive ? left : left.toLowerCase();
  const r = cfg.caseSensitive ? right : right.toLowerCase();
  switch (cfg.operator) {
    case "equals":
      return l.trim() === r.trim();
    case "option_selected":
      // Several ids ("web,ads") when the question allowed more than one choice.
      return l.split(",").some((id) => id.trim() === r.trim());
    case "not_equals":
      return l.trim() !== r.trim();
    case "contains":
      return r.length > 0 && l.includes(r);
    case "not_contains":
      return r.length === 0 || !l.includes(r);
    case "matches_regex":
      try {
        return new RegExp(right, cfg.caseSensitive ? "u" : "iu").test(left);
      } catch {
        return false;
      }
  }
  return false;
}

/** Parse a reply according to the question node that asked it and store it in vars. */
function storeAnswer(ctx: RunContext, question: FlowNode, input: InboundInput) {
  if (question.type === "interactive") {
    const cfg = parseNodeConfig("interactive", question.data.config);
    ctx.exec.context.vars[cfg.variable] = matchOption(cfg.options, input);
    return;
  }
  if (question.type === "ask_question") {
    const cfg = parseNodeConfig("ask_question", question.data.config);
    ctx.exec.context.vars[cfg.variable] = (input.replyTitle ?? input.text ?? "").trim().slice(0, 4096);
  }
}

/** Persist an accepted answer into the (possibly incomplete) lead so partial enquiries are never lost. */
async function commitAnswerToLead(ctx: RunContext, question: FlowNode) {
  if (question.type !== "ask_question" && question.type !== "interactive") return;
  const cfg =
    question.type === "ask_question"
      ? parseNodeConfig("ask_question", question.data.config)
      : parseNodeConfig("interactive", question.data.config);
  const field = cfg.leadField as LeadField;
  if (field === "none") return;
  const value = ctx.exec.context.vars[cfg.variable];
  const patch: LeadPatch = { answers: { [cfg.variable]: value } };
  if (isOptionAnswer(value)) {
    if (!value.matched || !value.title) return;
    if (field === "service") {
      patch.service = value.title;
      patch.service_id = value.id;
    } else {
      patch[field] = value.title;
    }
  } else {
    const s = stringify(value).trim();
    if (!s) return;
    patch[field] = s.slice(0, 2000);
  }
  const lead = await ctx.deps.store.upsertLead({
    execution: ctx.exec,
    conversation: ctx.conversation,
    contact: ctx.contact,
    patch,
  });
  ctx.exec.context.leadId = lead.id;
}
