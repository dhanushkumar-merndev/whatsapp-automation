import { resumeAfterDelay } from "@/lib/engine/runner";
import { attemptCrmDelivery } from "@/lib/engine/crm-attempt";
import type { ScheduledJobRecord } from "@/lib/engine/types";
import { processConversation, type PipelineDeps } from "./process-conversation";

export type JobOutcome =
  | { status: "done"; detail: string }
  | { status: "skipped"; detail: string }
  /** Transient condition — respond non-2xx so QStash retries. */
  | { status: "retry"; detail: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Handles one QStash delivery. Idempotent: duplicate deliveries find the job
 * already claimed/finished and do nothing. Before resuming a flow it re-checks
 * the flow status, the conversation state and (inside the engine, before every
 * send) the 24-hour customer service window.
 */
export async function handleScheduledJob(
  deps: PipelineDeps,
  jobId: string,
  opts: { retried: number; lockWaitMs?: number } = { retried: 0 },
): Promise<JobOutcome> {
  const { store } = deps;
  const job = await store.getScheduledJob(jobId);
  if (!job) return { status: "skipped", detail: "unknown_job" };
  if (job.status !== "scheduled" && job.status !== "running") return { status: "skipped", detail: `job_${job.status}` };

  if (job.kind === "crm_retry") return runCrmRetry(deps, job);
  return runFlowResume(deps, job, opts.lockWaitMs ?? 8000);
}

async function runFlowResume(deps: PipelineDeps, job: ScheduledJobRecord, lockWaitMs: number): Promise<JobOutcome> {
  const { store } = deps;
  if (!job.conversationId || !job.executionId) {
    await store.finishScheduledJob(job.id, "failed", "missing_references");
    return { status: "skipped", detail: "missing_references" };
  }
  const token = globalThis.crypto.randomUUID();
  const deadline = Date.now() + lockWaitMs;
  let locked = await store.acquireLock(job.conversationId, token, 60);
  while (!locked && Date.now() < deadline) {
    await sleep(400);
    locked = await store.acquireLock(job.conversationId, token, 60);
  }
  if (!locked) return { status: "retry", detail: "conversation_busy" };

  let outcome: JobOutcome;
  try {
    const claimed = await store.claimScheduledJob(job.id);
    if (!claimed) {
      outcome = { status: "skipped", detail: "already_claimed" };
    } else {
      outcome = await resumeClaimed(deps, claimed);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.logger.error("flow resume failed", { jobId: job.id, error });
    await store.finishScheduledJob(job.id, "scheduled", error.slice(0, 500));
    outcome = { status: "retry", detail: error };
  } finally {
    await store.releaseLock(job.conversationId, token);
  }
  // Customer messages that arrived while this job held the lock.
  await processConversation(deps, job.conversationId);
  return outcome;
}

async function resumeClaimed(deps: PipelineDeps, job: ScheduledJobRecord): Promise<JobOutcome> {
  const { store } = deps;
  // Independent reads in one round; the checks below still run in the same order.
  const [exec, jobFlowStatus, ctx] = await Promise.all([
    store.getExecution(job.executionId!),
    job.flowId ? store.getFlowStatus(job.flowId) : null,
    store.getConversationContext(job.conversationId!),
  ]);
  if (!exec || exec.status !== "waiting_delay") {
    await store.finishScheduledJob(job.id, "skipped", `execution_${exec?.status ?? "missing"}`);
    return { status: "skipped", detail: `execution_${exec?.status ?? "missing"}` };
  }
  const flowStatus = job.flowId === exec.flowId ? jobFlowStatus : await store.getFlowStatus(exec.flowId);
  if (flowStatus !== "active" && flowStatus !== "testing") {
    await store.setExecutionStatus(exec.id, "paused", `Flow is ${flowStatus ?? "missing"}`);
    await store.finishScheduledJob(job.id, "cancelled", "flow_not_active");
    return { status: "skipped", detail: "flow_not_active" };
  }
  if (!ctx) {
    await store.finishScheduledJob(job.id, "failed", "conversation_missing");
    return { status: "skipped", detail: "conversation_missing" };
  }
  if (ctx.contact.optedOut || ctx.conversation.status === "handoff") {
    await store.setExecutionStatus(exec.id, "cancelled", ctx.contact.optedOut ? "Customer opted out" : "Conversation handed off");
    await store.finishScheduledJob(job.id, "cancelled", "conversation_not_automatable");
    return { status: "skipped", detail: "conversation_not_automatable" };
  }
  const version = await store.getFlowVersion(exec.flowVersionId);
  if (!version) throw new Error("Flow version missing");
  const { execution, resumed } = await resumeAfterDelay(deps, {
    execution: exec,
    version,
    conversation: ctx.conversation,
    contact: ctx.contact,
    jobId: job.id,
  });
  await store.finishScheduledJob(job.id, resumed ? "completed" : "skipped", resumed ? null : "not_resumable");
  return { status: resumed ? "done" : "skipped", detail: execution.status };
}

async function runCrmRetry(deps: PipelineDeps, job: ScheduledJobRecord): Promise<JobOutcome> {
  const { store } = deps;
  const claimed = await store.claimScheduledJob(job.id);
  if (!claimed) return { status: "skipped", detail: "already_claimed" };
  const delivery = claimed.crmDeliveryId ? await store.getCrmDelivery(claimed.crmDeliveryId) : null;
  if (!delivery || delivery.status === "succeeded" || delivery.status === "failed") {
    await store.finishScheduledJob(job.id, "skipped", `delivery_${delivery?.status ?? "missing"}`);
    return { status: "skipped", detail: "nothing_to_retry" };
  }
  const [integration] = await store.listCrmIntegrations({ enabledOnly: false, id: delivery.integrationId });
  if (!integration || !integration.enabled) {
    await store.updateCrmDelivery(delivery.id, { status: "deferred", last_error: "Integration disabled" });
    await store.finishScheduledJob(job.id, "skipped", "integration_disabled");
    return { status: "skipped", detail: "integration_disabled" };
  }
  const result = await attemptCrmDelivery(deps, integration, delivery);
  await store.finishScheduledJob(job.id, "completed");
  return { status: "done", detail: result };
}
