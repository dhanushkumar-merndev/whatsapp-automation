import type { CrmDeliveryRecord, CrmIntegrationRecord, EngineDeps } from "./types";

/** Exponential backoff for CRM retries: 1m, 2m, 4m … capped at 6h. */
export function crmBackoffSeconds(attempt: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempt - 1), 6 * 3600);
}

/**
 * Attempt one CRM delivery and record the outcome. The lead is already saved
 * locally, so a failure here never loses it: retryable failures are queued
 * via QStash (or deferred to the daily sweep when the usage cap is reached).
 */
export async function attemptCrmDelivery(
  deps: Pick<EngineDeps, "store" | "crm" | "scheduler" | "settings" | "now" | "logger">,
  integration: CrmIntegrationRecord,
  delivery: CrmDeliveryRecord,
): Promise<"succeeded" | "retrying" | "deferred" | "failed"> {
  const { store } = deps;
  const attempts = delivery.attempts + 1;
  const result = await deps.crm.deliver(integration, delivery);
  await store.incrementUsage({ service: "crm", metric: "deliveries", isTest: delivery.isTest });

  if (result.ok) {
    const at = deps.now().toISOString();
    await store.updateCrmDelivery(delivery.id, {
      status: "succeeded",
      attempts,
      last_status_code: result.statusCode,
      last_error: null,
      response_excerpt: result.responseExcerpt,
      delivered_at: at,
      next_attempt_at: null,
    });
    await store.setLeadCrmStatus(delivery.leadId, "synced", at);
    await store.markCrmIntegrationResult(integration.id, true);
    return "succeeded";
  }

  await store.markCrmIntegrationResult(integration.id, false, result.error);
  const canRetry = result.retryable && attempts < delivery.maxAttempts;
  if (!canRetry) {
    await store.updateCrmDelivery(delivery.id, {
      status: "failed",
      attempts,
      last_status_code: result.statusCode,
      last_error: result.error,
      response_excerpt: result.responseExcerpt,
      next_attempt_at: null,
    });
    await store.setLeadCrmStatus(delivery.leadId, "failed");
    await store.notify({
      kind: "crm_failed",
      severity: "warning",
      title: `CRM delivery to "${integration.name}" failed`,
      body: `${result.error ?? "Unknown error"}. The lead is saved; retry it from Leads or CRM Integrations.`,
      link: `/leads/${delivery.leadId}`,
      entityType: "lead",
      entityId: delivery.leadId,
    });
    return "failed";
  }

  const delay = crmBackoffSeconds(attempts);
  const nextAt = new Date(deps.now().getTime() + delay * 1000).toISOString();
  const capped =
    deps.settings.usage.hardCapEnabled &&
    (await store.usageToday("qstash", "deliveries")) >= deps.settings.usage.qstashDailyBudget;

  if (capped) {
    // Non-essential job: defer to the daily sweep / manual retry instead of spending QStash budget.
    await store.updateCrmDelivery(delivery.id, {
      status: "deferred",
      attempts,
      last_status_code: result.statusCode,
      last_error: result.error,
      response_excerpt: result.responseExcerpt,
      next_attempt_at: nextAt,
    });
    await store.setLeadCrmStatus(delivery.leadId, "pending");
    return "deferred";
  }

  const { job, created } = await store.createScheduledJob({
    kind: "crm_retry",
    executionId: null,
    conversationId: null,
    nodeId: null,
    crmDeliveryId: delivery.id,
    flowId: null,
    runAt: nextAt,
    idempotencyKey: `crm:${delivery.id}:${attempts}`,
    isTest: delivery.isTest,
  });
  if (created) {
    try {
      const { messageId } = await deps.scheduler.schedule({ jobId: job.id, delaySeconds: delay });
      await store.attachJobMessage(job.id, messageId);
      await store.incrementUsage({ service: "qstash", metric: "deliveries", isTest: delivery.isTest });
    } catch (e) {
      deps.logger.error("crm retry scheduling failed", { deliveryId: delivery.id, error: String(e) });
      await store.finishScheduledJob(job.id, "failed", "schedule_failed");
      await store.updateCrmDelivery(delivery.id, {
        status: "deferred",
        attempts,
        last_status_code: result.statusCode,
        last_error: result.error,
        next_attempt_at: nextAt,
      });
      await store.setLeadCrmStatus(delivery.leadId, "pending");
      return "deferred";
    }
  }
  await store.updateCrmDelivery(delivery.id, {
    status: "retrying",
    attempts,
    last_status_code: result.statusCode,
    last_error: result.error,
    response_excerpt: result.responseExcerpt,
    next_attempt_at: nextAt,
  });
  await store.setLeadCrmStatus(delivery.leadId, "pending");
  return "retrying";
}
