import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { processConversation, type PipelineDeps } from "@/lib/core/process-conversation";
import { handleScheduledJob } from "@/lib/core/jobs";
import { attemptCrmDelivery } from "@/lib/engine/crm-attempt";
import { fetchUpstashRedisStats } from "@/lib/usage/providers";
import { toIntegration } from "./supabase-store";

type Report = Record<string, number | string>;

async function setUsage(service: string, metric: string, day: string, source: string, quantity: number) {
  const admin = createAdminClient();
  await admin
    .from("usage_records")
    .upsert(
      { service, metric, period_start: day, source, flow_id: null, is_test: false, quantity, updated_at: new Date().toISOString() },
      { onConflict: "service,metric,period_start,source,flow_id,is_test" },
    );
}

/**
 * Daily maintenance (Vercel Cron). Safety net for anything a crashed function
 * left behind, plus retention and usage snapshots. Every step is idempotent.
 */
export async function runSweep(deps: PipelineDeps): Promise<Report> {
  const admin = createAdminClient();
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const report: Report = {};

  // 1. Inbound messages never processed (e.g. function crashed after acknowledging Meta).
  const { data: stranded } = await admin
    .from("messages")
    .select("conversation_id")
    .eq("direction", "inbound")
    .eq("processing_status", "pending")
    .lt("created_at", iso(2 * 60_000))
    .limit(200);
  const convs = [...new Set((stranded ?? []).map((m) => m.conversation_id as string))].slice(0, 40);
  for (const c of convs) await processConversation(deps, c);
  report.strandedConversations = convs.length;

  // 2. Delayed steps whose QStash delivery never arrived (e.g. ended in the DLQ).
  const { data: lateJobs } = await admin
    .from("scheduled_jobs")
    .select("id")
    .eq("status", "scheduled")
    .lt("run_at", iso(15 * 60_000))
    .limit(25);
  for (const j of lateJobs ?? []) await handleScheduledJob(deps, j.id, { retried: 0, lockWaitMs: 2000 });
  report.recoveredJobs = lateJobs?.length ?? 0;

  // 3. CRM deliveries deferred by the usage cap or left without a pending retry job.
  const { data: deliveries } = await admin
    .from("crm_deliveries")
    .select("*, crm_integrations(*)")
    .in("status", ["deferred", "retrying", "pending"])
    .lt("updated_at", iso(30 * 60_000))
    .limit(25);
  let crmRetried = 0;
  for (const d of deliveries ?? []) {
    const integration = d.crm_integrations ? toIntegration(d.crm_integrations as Record<string, unknown>) : null;
    if (!integration?.enabled) continue;
    await attemptCrmDelivery(deps, integration, {
      id: d.id,
      integrationId: d.integration_id,
      leadId: d.lead_id,
      eventId: d.event_id,
      eventType: d.event_type,
      payload: d.payload,
      status: d.status,
      attempts: d.attempts,
      maxAttempts: d.max_attempts,
      isTest: d.is_test,
    });
    crmRetried++;
  }
  report.crmRetried = crmRetried;

  // 4. Enquiries the customer never finished → abandoned (the incomplete lead stays).
  const { data: abandoned } = await admin
    .from("flow_executions")
    .update({ status: "abandoned", awaiting: null, completed_at: new Date().toISOString(), error: "No reply within the resume window" })
    .eq("status", "waiting_input")
    .lt("last_activity_at", iso(deps.settings.execution.resumeWithinHours * 3_600_000))
    .select("id");
  report.abandonedExecutions = abandoned?.length ?? 0;

  // 5. Retention / data minimisation.
  const r = deps.settings.retention;
  if (r.messageBodyDays > 0) {
    const { data } = await admin
      .from("messages")
      .update({ body: null, payload: null })
      .lt("created_at", iso(r.messageBodyDays * 86_400_000))
      .not("body", "is", null)
      .select("id");
    report.redactedMessages = data?.length ?? 0;
  }
  if (r.executionLogDays > 0) {
    await admin.from("node_executions").delete().lt("created_at", iso(r.executionLogDays * 86_400_000));
  }
  if (r.securityEventDays > 0) {
    await admin.from("rate_limit_events").delete().lt("created_at", iso(r.securityEventDays * 86_400_000));
  }
  await admin.from("notifications").delete().not("read_at", "is", null).lt("created_at", iso(90 * 86_400_000));

  // 6. Abandoned uploads (never finalised) older than a day.
  const { data: pendingUploads } = await admin.from("media_assets").select("id, storage_path").eq("status", "pending").lt("created_at", iso(86_400_000));
  if (pendingUploads?.length) {
    await admin.storage.from("media").remove(pendingUploads.map((u) => u.storage_path));
    await admin.from("media_assets").delete().in("id", pendingUploads.map((u) => u.id));
  }
  report.cleanedUploads = pendingUploads?.length ?? 0;

  // 7. Usage snapshots: measured storage + provider-reported Redis commands when available.
  const day = new Date().toISOString().slice(0, 10);
  const { data: storage } = await admin.rpc("get_storage_usage");
  if (storage) {
    const s = storage as { database_bytes: number; media_bytes: number };
    await setUsage("supabase_db", "database_bytes", day, "local_measured", Number(s.database_bytes));
    await setUsage("supabase_storage", "media_bytes", day, "local_measured", Number(s.media_bytes));
  }
  const redis = await fetchUpstashRedisStats();
  if (redis) {
    for (const d of redis.dailyCommands.slice(-35)) await setUsage("redis", "commands", d.day, "provider", d.count);
    report.redisProviderStats = "updated";
  } else {
    report.redisProviderStats = "not_configured";
  }
  return report;
}
