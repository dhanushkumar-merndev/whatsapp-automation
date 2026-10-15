import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { hashIdentifier } from "@/lib/ratelimit";
import { flowDefinitionSchema } from "@/lib/engine/schema";
import { appUrl } from "@/lib/env";
import { forwardNotification, telegramEventFor } from "@/lib/notify/telegram";
import { loadSettings } from "@/lib/settings/server";
import {
  ACTIVE_EXECUTION_STATUSES,
  OPEN_LEAD_STATUSES,
  type BookingRecord,
  type ClaimResult,
  type ContactSnapshot,
  type ConversationSnapshot,
  type CrmCredentials,
  type CrmDeliveryRecord,
  type CrmIntegrationRecord,
  type ExecutionContext,
  type ExecutionRecord,
  type ExecutionStatus,
  type FlowVersionRecord,
  type LeadPatch,
  type LeadRecord,
  type MediaAssetRecord,
  type NodeLogEntry,
  type NotificationInput,
  type OutboundClaim,
  type ScheduledJobRecord,
  type ScheduledJobStatus,
} from "@/lib/engine/types";
import type {
  AppStore,
  BeginTurnResult,
  BusinessEchoInput,
  HistoryMessage,
  FlowStatus,
  InboundProcessingStatus,
  InboundRecordInput,
  InboundRecordResult,
  PendingInbound,
  StatusUpdateInput,
  TurnState,
} from "@/lib/core/types";

type Row = Record<string, unknown>;
const TERMINAL: ExecutionStatus[] = ["completed", "handoff", "window_expired", "failed", "cancelled", "abandoned", "paused"];

function check<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

function toExecution(r: Row): ExecutionRecord {
  const ctx = (r.context ?? {}) as Partial<ExecutionContext>;
  return {
    id: r.id as string,
    flowId: r.flow_id as string,
    flowVersionId: r.flow_version_id as string,
    conversationId: r.conversation_id as string,
    contactId: r.contact_id as string,
    status: r.status as ExecutionStatus,
    currentNodeId: (r.current_node_id as string) ?? null,
    step: Number(r.step ?? 0),
    context: {
      vars: ctx.vars ?? {},
      attempts: ctx.attempts ?? {},
      lastQuestionNodeId: ctx.lastQuestionNodeId ?? null,
      isNewCustomer: ctx.isNewCustomer ?? false,
      leadId: ctx.leadId ?? null,
      path: ctx.path ?? [],
      prompts: ctx.prompts ?? {},
    },
    awaiting: (r.awaiting as ExecutionRecord["awaiting"]) ?? null,
    isTest: Boolean(r.is_test),
    error: (r.error as string) ?? null,
    startedAt: r.started_at as string,
    lastActivityAt: r.last_activity_at as string,
    completedAt: (r.completed_at as string) ?? null,
  };
}

function toLead(r: Row): LeadRecord {
  return {
    id: r.id as string,
    contactId: r.contact_id as string,
    conversationId: r.conversation_id as string,
    flowId: (r.flow_id as string) ?? null,
    flowExecutionId: (r.flow_execution_id as string) ?? null,
    name: (r.name as string) ?? null,
    businessName: (r.business_name as string) ?? null,
    service: (r.service as string) ?? null,
    serviceId: (r.service_id as string) ?? null,
    requirements: (r.requirements as string) ?? null,
    email: (r.email as string) ?? null,
    phone: r.phone as string,
    status: r.status as LeadRecord["status"],
    crmSyncStatus: r.crm_sync_status as LeadRecord["crmSyncStatus"],
    isTest: Boolean(r.is_test),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toJob(r: Row): ScheduledJobRecord {
  return {
    id: r.id as string,
    kind: r.kind as ScheduledJobRecord["kind"],
    executionId: (r.execution_id as string) ?? null,
    conversationId: (r.conversation_id as string) ?? null,
    nodeId: (r.node_id as string) ?? null,
    crmDeliveryId: (r.crm_delivery_id as string) ?? null,
    flowId: (r.flow_id as string) ?? null,
    bookingId: (r.booking_id as string) ?? null,
    runAt: r.run_at as string,
    status: r.status as ScheduledJobStatus,
    qstashMessageId: (r.qstash_message_id as string) ?? null,
    attempts: Number(r.attempts ?? 0),
    lastError: (r.last_error as string) ?? null,
    isTest: Boolean(r.is_test),
  };
}

export function toMedia(r: Row): MediaAssetRecord {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as MediaAssetRecord["kind"],
    mimeType: r.mime_type as string,
    sizeBytes: Number(r.size_bytes ?? 0),
    storagePath: r.storage_path as string,
    status: r.status as MediaAssetRecord["status"],
    metaMediaId: (r.meta_media_id as string) ?? null,
    metaMediaUploadedAt: (r.meta_media_uploaded_at as string) ?? null,
    metaPhoneNumberId: (r.meta_phone_number_id as string) ?? null,
    deletedAt: (r.deleted_at as string) ?? null,
  };
}

function toDelivery(r: Row): CrmDeliveryRecord {
  return {
    id: r.id as string,
    integrationId: r.integration_id as string,
    leadId: r.lead_id as string,
    eventId: r.event_id as string,
    eventType: r.event_type as string,
    payload: (r.payload as Record<string, unknown>) ?? {},
    status: r.status as CrmDeliveryRecord["status"],
    attempts: Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 6),
    isTest: Boolean(r.is_test),
  };
}

export function toIntegration(r: Row): CrmIntegrationRecord {
  let credentials: CrmCredentials = {};
  let signingSecret: string | null = null;
  try {
    if (r.credentials_encrypted) credentials = JSON.parse(decryptSecret(r.credentials_encrypted as string));
    if (r.signing_secret_encrypted) signingSecret = decryptSecret(r.signing_secret_encrypted as string);
  } catch {
    // Wrong/rotated APP_ENCRYPTION_KEY: deliver without credentials; the CRM will reject and the error is shown.
  }
  return {
    id: r.id as string,
    name: r.name as string,
    url: r.url as string,
    enabled: Boolean(r.enabled),
    authType: (r.auth_type as CrmIntegrationRecord["authType"]) ?? "none",
    credentials,
    signingSecret,
    fieldMapping: (r.field_mapping as Record<string, string>) ?? {},
  };
}

// Per-instance cache on the reply path. Published flow versions never change
// (only the flow name can, so it may lag a rename by up to the TTL).
const VERSION_TTL_MS = 10 * 60_000;
const VERSION_CACHE_MAX = 50;
const versionCache = new Map<string, { at: number; value: FlowVersionRecord }>();

function toPending(m: Row): PendingInbound {
  return {
    id: m.id as string,
    waMessageId: m.wa_message_id as string,
    type: m.type as string,
    body: (m.body as string) ?? null,
    payload: (m.payload as Record<string, unknown>) ?? {},
    providerTimestamp: m.provider_timestamp as string,
  };
}

function toTurnState(r: Row | null): TurnState | null {
  if (!r) return null;
  const cv = r.conversation as Row;
  const c = r.contact as Row;
  const active = (r.active as Row | null) ?? null;
  return {
    conversation: {
      id: cv.id as string,
      contactId: cv.contact_id as string,
      accountId: cv.account_id as string,
      phoneNumberId: cv.phone_number_id as string,
      status: cv.status as TurnState["conversation"]["status"],
      lastInboundAt: (cv.last_inbound_at as string) ?? null,
      isTest: Boolean(cv.is_test),
      handoffBy: (cv.handoff_by as TurnState["conversation"]["handoffBy"]) ?? null,
      handoffAt: (cv.handoff_at as string) ?? null,
      humanLastReplyAt: (cv.human_last_reply_at as string) ?? null,
    },
    contact: {
      id: c.id as string,
      waId: c.wa_id as string,
      name: (c.name as string) ?? null,
      profileName: (c.profile_name as string) ?? null,
      businessName: (c.business_name as string) ?? null,
      email: (c.email as string) ?? null,
      optedOut: Boolean(c.opted_out),
      cooldownUntil: (c.cooldown_until as string) ?? null,
      isTest: Boolean(c.is_test),
      openEnquiryAt: (c.open_enquiry_at as string) ?? null,
      tags: (c.tags as string[]) ?? [],
    },
    active: active ? toExecution(active) : null,
    activeFlowStatus: active ? ((active.flow_status as FlowStatus) ?? null) : null,
    lastCompletedAt: (r.last_completed_at as string) ?? null,
    candidates: ((r.candidates as Row[]) ?? []).map((f) => ({
      flowId: f.flow_id as string,
      flowName: f.flow_name as string,
      status: f.status as FlowStatus,
      priority: Number(f.priority),
      versionId: f.version_id as string,
      version: Number(f.version),
    })),
    priorExecutions: Number(r.prior_executions ?? 0),
  };
}

export interface SupabaseStoreOptions {
  /**
   * Node logs, notifications and the conversation's last-outbound time are written without blocking the caller, so replies go
   * out sooner. Nothing reads them back mid-run. Callers must await flush().
   */
  backgroundWrites?: boolean;
}

/** Production persistence (service role; callers are authenticated by signature/secret). */
export class SupabaseStore implements AppStore {
  private readonly backgroundWrites: boolean;
  private readonly pending = new Set<Promise<void>>();
  /** Node logs are listed by id, so their inserts stay in order. */
  private logChain: Promise<void> = Promise.resolve();
  /**
   * Execution saves and send results, in order. Anything that reads or changes
   * execution state — and releasing the conversation lock — waits for it, so
   * no other request ever sees a stale execution.
   */
  private stateChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: SupabaseClient = createAdminClient(),
    opts: SupabaseStoreOptions = {},
  ) {
    this.backgroundWrites = opts.backgroundWrites ?? false;
  }

  /** Waits for every background write, including ones started while waiting. */
  async flush() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** Runs a write that nothing reads back mid-run: in the background when enabled (errors are logged), otherwise inline. */
  private telemetry(what: string, write: () => Promise<void>): Promise<void> {
    if (!this.backgroundWrites) return write();
    this.defer(what, write);
    return Promise.resolve();
  }

  /** Ordered state write: in the background when enabled, otherwise inline. */
  private stateWrite(what: string, write: () => Promise<void>): Promise<void> {
    if (!this.backgroundWrites) return write();
    const previous = this.stateChain;
    this.stateChain = this.defer(what, () => previous.then(write));
    return Promise.resolve();
  }

  background(what: string, task: () => Promise<unknown>) {
    void this.defer(what, async () => {
      await task();
    });
  }

  private defer(what: string, write: () => Promise<void>): Promise<void> {
    const p: Promise<void> = Promise.resolve()
      .then(write)
      .catch((e) => console.warn(`[store] ${what} failed`, e instanceof Error ? e.message : String(e)))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
    return p;
  }

  // --- Inbound ---------------------------------------------------------------

  async recordInbound(input: InboundRecordInput): Promise<InboundRecordResult> {
    const r = check(
      await this.db.rpc("record_inbound_message", {
        p: {
          account_id: input.accountId ?? "",
          phone_number_id: input.phoneNumberId ?? "",
          waba_id: input.wabaId ?? "",
          wa_id: input.waId,
          profile_name: input.profileName,
          wa_message_id: input.waMessageId,
          type: input.type,
          body: input.body,
          payload: input.payload,
          provider_timestamp: input.providerTimestamp,
          is_test: input.isTest,
        },
      }),
      "record inbound",
    ) as Row;
    if (r.ignored) return { ignored: "unknown_account" };
    return {
      accountId: r.account_id as string,
      contactId: r.contact_id as string,
      conversationId: r.conversation_id as string,
      conversationStatus: r.conversation_status as TurnState["conversation"]["status"],
      optedOut: Boolean(r.opted_out),
      cooldownUntil: (r.cooldown_until as string) ?? null,
      isTest: Boolean(r.is_test),
      messageId: (r.message_id as string) ?? null,
      duplicate: Boolean(r.duplicate),
      newContact: Boolean(r.new_contact),
    };
  }

  async recordBusinessEcho(input: BusinessEchoInput) {
    const r = check(
      await this.db.rpc("record_business_echo", {
        p: {
          phone_number_id: input.phoneNumberId,
          waba_id: input.wabaId,
          wa_id: input.waId,
          wa_message_id: input.waMessageId,
          type: input.type,
          body: input.body,
          payload: input.payload,
          provider_timestamp: input.providerTimestamp,
        },
      }),
      "record echo",
    ) as Row;
    if (r.ignored) return { ignored: true as const };
    return { conversationId: r.conversation_id as string, duplicate: Boolean(r.duplicate), tookOver: Boolean(r.took_over) };
  }

  async recordHistory(input: { phoneNumberId: string; wabaId: string; waId: string; messages: HistoryMessage[] }) {
    const n = check(
      await this.db.rpc("record_history", {
        p: {
          phone_number_id: input.phoneNumberId,
          waba_id: input.wabaId,
          wa_id: input.waId,
          messages: input.messages.map((m) => ({
            direction: m.direction,
            wa_message_id: m.waMessageId,
            type: m.type,
            body: m.body,
            payload: m.payload,
            provider_timestamp: m.providerTimestamp,
          })),
        },
      }),
      "record history",
    );
    return Number(n ?? 0);
  }

  async syncBusinessContacts(contacts: { waId: string; fullName: string | null; firstName: string | null; action: "add" | "remove" }[]) {
    const n = check(
      await this.db.rpc("sync_business_contacts", {
        p: contacts.map((c) => ({ wa_id: c.waId, full_name: c.fullName, first_name: c.firstName, action: c.action })),
      }),
      "sync contacts",
    );
    return Number(n ?? 0);
  }

  async applyStatus(input: StatusUpdateInput) {
    return Boolean(
      check(
        await this.db.rpc("apply_message_status", {
          p_wa_message_id: input.waMessageId,
          p_status: input.status,
          p_error: input.error,
          p_billable: input.billable,
          p_category: input.category,
          p_model: input.model,
        }),
        "apply status",
      ),
    );
  }

  async acquireLock(conversationId: string, token: string, ttlSeconds: number) {
    return Boolean(
      check(
        await this.db.rpc("acquire_conversation_lock", { p_conversation_id: conversationId, p_token: token, p_ttl_seconds: ttlSeconds }),
        "acquire lock",
      ),
    );
  }

  async beginTurn(conversationId: string, token: string, ttlSeconds: number, limit: number): Promise<BeginTurnResult> {
    await this.stateChain;
    const r = check(
      await this.db.rpc("begin_turn", { p_conversation_id: conversationId, p_token: token, p_ttl_seconds: ttlSeconds, p_limit: limit }),
      "begin turn",
    ) as Row;
    if (!r.locked) return { locked: false };
    return { locked: true, pending: ((r.pending as Row[]) ?? []).map(toPending), state: toTurnState(r.state as Row | null) };
  }

  async getTurnState(conversationId: string) {
    await this.stateChain;
    return toTurnState(check(await this.db.rpc("conversation_turn_state", { p_conversation_id: conversationId }), "load turn state") as Row | null);
  }

  async releaseLock(conversationId: string, token: string) {
    await this.stateChain;
    check(await this.db.rpc("release_conversation_lock", { p_conversation_id: conversationId, p_token: token }), "release lock");
  }

  async listPendingInbound(conversationId: string, limit: number): Promise<PendingInbound[]> {
    const rows = check(
      await this.db
        .from("messages")
        .select("id, wa_message_id, type, body, payload, provider_timestamp")
        .eq("conversation_id", conversationId)
        .eq("direction", "inbound")
        .eq("processing_status", "pending")
        .order("provider_timestamp", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(limit),
      "list pending",
    );
    return (rows ?? []).map(toPending);
  }

  async markInbound(messageId: string, status: InboundProcessingStatus, note?: string | null, executionId?: string | null) {
    const patch: Row = { processing_status: status, processing_note: note ?? null };
    if (executionId) patch.flow_execution_id = executionId;
    check(await this.db.from("messages").update(patch).eq("id", messageId), "mark inbound");
  }

  async getConversationContext(conversationId: string) {
    // The latest open enquiry is embedded so the whole context is one round trip.
    const r = check(
      await this.db
        .from("conversations")
        .select(
          "id, contact_id, account_id, status, last_inbound_at, is_test, handoff_by, handoff_at, human_last_reply_at, whatsapp_accounts(phone_number_id), contacts(id, wa_id, name, profile_name, business_name, email, opted_out, cooldown_until, is_test, tags, leads(created_at))",
        )
        .eq("id", conversationId)
        .in("contacts.leads.status", [...OPEN_LEAD_STATUSES])
        .order("created_at", { referencedTable: "contacts.leads", ascending: false })
        .limit(1, { referencedTable: "contacts.leads" })
        .maybeSingle(),
      "load conversation",
    );
    if (!r) return null;
    const acc = (Array.isArray(r.whatsapp_accounts) ? r.whatsapp_accounts[0] : r.whatsapp_accounts) as { phone_number_id: string };
    const c = (Array.isArray(r.contacts) ? r.contacts[0] : r.contacts) as Row;
    const openLead = ((c.leads as { created_at: string }[] | null) ?? [])[0];
    const conversation: ConversationSnapshot = {
      id: r.id,
      contactId: r.contact_id,
      accountId: r.account_id,
      phoneNumberId: acc.phone_number_id,
      status: r.status,
      lastInboundAt: r.last_inbound_at,
      isTest: r.is_test,
      handoffBy: r.handoff_by ?? null,
      handoffAt: r.handoff_at ?? null,
      humanLastReplyAt: r.human_last_reply_at ?? null,
    };
    const contact: ContactSnapshot = {
      id: c.id as string,
      waId: c.wa_id as string,
      name: (c.name as string) ?? null,
      profileName: (c.profile_name as string) ?? null,
      businessName: (c.business_name as string) ?? null,
      email: (c.email as string) ?? null,
      optedOut: Boolean(c.opted_out),
      cooldownUntil: (c.cooldown_until as string) ?? null,
      isTest: Boolean(c.is_test),
      openEnquiryAt: openLead?.created_at ?? null,
      tags: (c.tags as string[]) ?? [],
    };
    return { conversation, contact };
  }

  async getActiveExecution(conversationId: string) {
    await this.stateChain;
    const r = check(
      await this.db
        .from("flow_executions")
        .select("*")
        .eq("conversation_id", conversationId)
        .in("status", ACTIVE_EXECUTION_STATUSES as string[])
        .limit(1)
        .maybeSingle(),
      "load active execution",
    );
    return r ? toExecution(r) : null;
  }

  async getExecution(id: string) {
    await this.stateChain;
    const r = check(await this.db.from("flow_executions").select("*").eq("id", id).maybeSingle(), "load execution");
    return r ? toExecution(r) : null;
  }

  async getFlowVersion(versionId: string): Promise<FlowVersionRecord | null> {
    const hit = versionCache.get(versionId);
    if (hit && Date.now() - hit.at < VERSION_TTL_MS) return hit.value;
    // flows ↔ flow_versions are linked twice (flow_id and flows.published_version_id): name the FK.
    const r = check(
      await this.db
        .from("flow_versions")
        .select("id, flow_id, version, definition, flows!flow_versions_flow_id_fkey(name)")
        .eq("id", versionId)
        .maybeSingle(),
      "load flow version",
    );
    if (!r) return null;
    const flow = (Array.isArray(r.flows) ? r.flows[0] : r.flows) as { name: string } | null;
    const value: FlowVersionRecord = {
      id: r.id,
      flowId: r.flow_id,
      version: r.version,
      flowName: flow?.name ?? "Flow",
      definition: flowDefinitionSchema.parse(r.definition),
    };
    versionCache.delete(versionId);
    if (versionCache.size >= VERSION_CACHE_MAX) versionCache.delete(versionCache.keys().next().value!);
    versionCache.set(versionId, { at: Date.now(), value });
    return value;
  }

  async getFlowStatus(flowId: string) {
    const r = check(await this.db.from("flows").select("status").eq("id", flowId).maybeSingle(), "load flow status");
    return (r?.status as FlowStatus) ?? null;
  }

  async setExecutionStatus(id: string, status: ExecutionStatus, error?: string | null) {
    await this.stateChain;
    const now = new Date().toISOString();
    const patch: Row = { status, awaiting: null, last_activity_at: now };
    if (error !== undefined) patch.error = error;
    if (TERMINAL.includes(status)) patch.completed_at = now;
    check(await this.db.from("flow_executions").update(patch).eq("id", id), "set execution status");
  }

  async cancelJobsForExecution(executionId: string) {
    const rows = check(
      await this.db
        .from("scheduled_jobs")
        .update({ status: "cancelled", last_error: "execution_stopped" })
        .eq("execution_id", executionId)
        .eq("status", "scheduled")
        .select("qstash_message_id"),
      "cancel jobs",
    );
    return (rows ?? []).map((r) => r.qstash_message_id).filter((x): x is string => Boolean(x));
  }

  async getScheduledJob(id: string) {
    const r = check(await this.db.from("scheduled_jobs").select("*").eq("id", id).maybeSingle(), "load job");
    return r ? toJob(r) : null;
  }

  async claimScheduledJob(id: string) {
    const r = check(await this.db.rpc("claim_scheduled_job", { p_job_id: id }), "claim job") as Row | null;
    return r ? toJob(r) : null;
  }

  async getCrmDelivery(id: string) {
    const r = check(await this.db.from("crm_deliveries").select("*").eq("id", id).maybeSingle(), "load delivery");
    return r ? toDelivery(r) : null;
  }

  async recordSecurityEvent(input: { scope: string; identifier: string; contactId?: string | null; action?: string; detail?: Record<string, unknown> }) {
    check(
      await this.db.from("rate_limit_events").insert({
        scope: input.scope,
        identifier: hashIdentifier(input.identifier),
        contact_id: input.contactId ?? null,
        action: input.action ?? "blocked",
        detail: input.detail ?? null,
      }),
      "record security event",
    );
  }

  async countRecentSecurityEvents(scope: string, contactId: string, sinceIso: string) {
    const { count, error } = await this.db
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("scope", scope)
      .eq("contact_id", contactId)
      .gte("created_at", sinceIso);
    if (error) throw new Error(`count security events: ${error.message}`);
    return count ?? 0;
  }

  // --- Engine store ------------------------------------------------------------

  async createExecution(input: {
    flowId: string;
    flowVersionId: string;
    conversationId: string;
    contactId: string;
    isTest: boolean;
    context: ExecutionContext;
    currentNodeId: string;
  }) {
    const { data, error } = await this.db
      .from("flow_executions")
      .insert({
        flow_id: input.flowId,
        flow_version_id: input.flowVersionId,
        conversation_id: input.conversationId,
        contact_id: input.contactId,
        is_test: input.isTest,
        context: input.context,
        current_node_id: input.currentNodeId,
        status: "running",
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return null; // another execution is already active for this conversation
      throw new Error(`create execution: ${error.message}`);
    }
    return toExecution(data);
  }

  async saveExecution(exec: ExecutionRecord) {
    // Snapshot now: the runner keeps mutating the record while this write waits.
    const row = {
      status: exec.status,
      current_node_id: exec.currentNodeId,
      step: exec.step,
      context: structuredClone(exec.context),
      awaiting: exec.awaiting ? structuredClone(exec.awaiting) : null,
      error: exec.error,
      last_activity_at: exec.lastActivityAt,
      completed_at: exec.completedAt,
    };
    await this.stateWrite("save execution", async () => {
      check(await this.db.from("flow_executions").update(row).eq("id", exec.id), "save execution");
    });
  }

  async logNode(entry: NodeLogEntry) {
    const row = {
      execution_id: entry.executionId,
      node_id: entry.nodeId,
      node_type: entry.nodeType,
      step: entry.step,
      status: entry.status,
      output_handle: entry.outputHandle ?? null,
      detail: entry.detail ?? null,
      error: entry.error ?? null,
      duration_ms: entry.durationMs ?? null,
    };
    const write = async () => {
      check(await this.db.from("node_executions").insert(row), "log node");
    };
    if (!this.backgroundWrites) return write();
    const previous = this.logChain;
    this.logChain = this.defer("log node", () => previous.then(write));
  }

  async claimOutbound(claim: OutboundClaim): Promise<ClaimResult> {
    const m = claim.message;
    const r = check(
      await this.db.rpc("claim_outbound_message", {
        p: {
          conversation_id: claim.conversationId,
          contact_id: claim.contactId,
          idempotency_key: claim.idempotencyKey,
          type: m.kind === "media" ? m.mediaType : m.kind === "text" || m.kind === "template" ? m.kind : "interactive",
          body: claim.preview,
          payload: m,
          media_asset_id: claim.mediaAssetId ?? "",
          flow_execution_id: claim.executionId ?? "",
          node_id: claim.nodeId,
          sent_by: claim.sentBy ?? "",
          is_test: claim.isTest,
        },
      }),
      "claim outbound",
    ) as Row;
    return r.status === "new"
      ? { status: "new", messageId: r.message_id as string }
      : { status: "duplicate", existingStatus: (r.existing_status as string) ?? "unknown" };
  }

  async completeOutbound(key: string, result: { waMessageId: string } | { error: string; skipped?: boolean }) {
    const at = new Date().toISOString();
    await this.stateWrite("complete outbound", async () => {
      if ("waMessageId" in result) {
        const rows = check(
          await this.db
            .from("messages")
            .update({ wa_message_id: result.waMessageId, status: "sent", provider_timestamp: at })
            .eq("idempotency_key", key)
            .select("conversation_id"),
          "complete outbound",
        );
        const conv = rows?.[0]?.conversation_id;
        if (conv) await this.db.from("conversations").update({ last_outbound_at: at }).eq("id", conv);
      } else {
        check(
          await this.db
            .from("messages")
            .update({ status: result.skipped ? "skipped" : "failed", error: { message: result.error.slice(0, 1000) } })
            .eq("idempotency_key", key),
          "fail outbound",
        );
      }
    });
  }

  async hasRecentMediaSend(contactId: string, assetId: string, sinceIso: string) {
    const { count, error } = await this.db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("contact_id", contactId)
      .eq("media_asset_id", assetId)
      .in("status", ["pending", "sent", "delivered", "read"])
      .gte("created_at", sinceIso);
    if (error) throw new Error(`media cooldown: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async hasRecentNodeSend(contactId: string, flowId: string, nodeId: string, sinceIso: string) {
    const { count, error } = await this.db
      .from("messages")
      .select("id, flow_executions!inner(flow_id)", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("contact_id", contactId)
      .eq("node_id", nodeId)
      .eq("flow_executions.flow_id", flowId)
      .in("status", ["pending", "sent", "delivered", "read"])
      .gte("created_at", sinceIso);
    if (error) throw new Error(`message cooldown: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async getMediaAsset(id: string) {
    const r = check(await this.db.from("media_assets").select("*").eq("id", id).maybeSingle(), "load media");
    return r ? toMedia(r) : null;
  }

  async upsertLead(input: { execution: ExecutionRecord; conversation: ConversationSnapshot; contact: ContactSnapshot; patch: LeadPatch }) {
    const p = input.patch;
    const existing = check(
      await this.db.from("leads").select("id, answers").eq("flow_execution_id", input.execution.id).maybeSingle(),
      "load lead",
    );
    const fields: Row = { last_activity_at: new Date().toISOString() };
    for (const k of ["name", "business_name", "service", "service_id", "requirements", "email", "status"] as const) {
      if (p[k] !== undefined) fields[k] = p[k];
    }
    if (existing) {
      if (p.answers) fields.answers = { ...((existing.answers as Row) ?? {}), ...p.answers };
      const r = check(await this.db.from("leads").update(fields).eq("id", existing.id).select("*").single(), "update lead");
      return toLead(r);
    }
    const r = check(
      await this.db
        .from("leads")
        .insert({
          ...fields,
          answers: p.answers ?? {},
          contact_id: input.contact.id,
          conversation_id: input.conversation.id,
          flow_id: input.execution.flowId,
          flow_version_id: input.execution.flowVersionId,
          flow_execution_id: input.execution.id,
          phone: input.contact.waId,
          is_test: input.execution.isTest,
          status: p.status ?? "incomplete",
        })
        .select("*")
        .single(),
      "insert lead",
    );
    return toLead(r);
  }

  async getLead(id: string) {
    const r = check(await this.db.from("leads").select("*").eq("id", id).maybeSingle(), "load lead");
    return r ? toLead(r) : null;
  }

  async updateContact(
    id: string,
    patch: Partial<{ name: string | null; business_name: string | null; email: string | null; opted_out: boolean; cooldown_until: string | null }>,
  ) {
    const p: Row = { ...patch };
    if (patch.opted_out !== undefined) p.opted_out_at = patch.opted_out ? new Date().toISOString() : null;
    check(await this.db.from("contacts").update(p).eq("id", id), "update contact");
  }

  async updateConversation(id: string, patch: Parameters<AppStore["updateConversation"]>[1]) {
    check(await this.db.from("conversations").update(patch).eq("id", id), "update conversation");
  }

  async createScheduledJob(input: {
    kind: ScheduledJobRecord["kind"];
    executionId: string | null;
    conversationId: string | null;
    nodeId: string | null;
    crmDeliveryId: string | null;
    flowId: string | null;
    runAt: string;
    idempotencyKey: string;
    isTest: boolean;
    bookingId?: string | null;
  }) {
    const { data, error } = await this.db
      .from("scheduled_jobs")
      .insert({
        booking_id: input.bookingId ?? null,
        kind: input.kind,
        execution_id: input.executionId,
        conversation_id: input.conversationId,
        node_id: input.nodeId,
        crm_delivery_id: input.crmDeliveryId,
        flow_id: input.flowId,
        run_at: input.runAt,
        idempotency_key: input.idempotencyKey,
        is_test: input.isTest,
      })
      .select("*")
      .single();
    if (!error) return { job: toJob(data), created: true };
    if (error.code !== "23505") throw new Error(`create job: ${error.message}`);
    const existing = check(
      await this.db.from("scheduled_jobs").select("*").eq("idempotency_key", input.idempotencyKey).single(),
      "load existing job",
    );
    return { job: toJob(existing), created: false };
  }

  async attachJobMessage(jobId: string, qstashMessageId: string | null) {
    check(await this.db.from("scheduled_jobs").update({ qstash_message_id: qstashMessageId }).eq("id", jobId), "attach job message");
  }

  async countBookings(input: { calendar: string; fromIso: string; toIso: string }) {
    const rows = check(
      await this.db
        .from("bookings")
        .select("starts_at")
        .eq("calendar", input.calendar)
        .in("status", ["booked", "confirmed"])
        .gte("starts_at", input.fromIso)
        .lte("starts_at", input.toIso)
        .limit(5000),
      "count bookings",
    );
    const out = new Map<number, number>();
    for (const r of rows ?? []) {
      const t = new Date(r.starts_at as string).getTime();
      out.set(t, (out.get(t) ?? 0) + 1);
    }
    return out;
  }

  async createBooking(input: Parameters<AppStore["createBooking"]>[0]): Promise<{ ok: true; id: string } | { ok: false }> {
    const r = check(
      await this.db.rpc("book_slot", {
        p: {
          calendar: input.calendar,
          capacity: input.capacity,
          contact_id: input.contact.id,
          conversation_id: input.conversation.id,
          flow_id: input.execution.flowId,
          flow_execution_id: input.execution.id,
          node_id: input.nodeId,
          lead_id: input.execution.context.leadId ?? "",
          service: input.service ?? "",
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          timezone: input.timezone,
          reminder: input.reminder,
          is_test: input.execution.isTest,
        },
      }),
      "book slot",
    ) as Row;
    return r.ok ? { ok: true, id: r.id as string } : { ok: false };
  }

  async getBooking(id: string) {
    const r = check(await this.db.from("bookings").select("*").eq("id", id).maybeSingle(), "load booking");
    if (!r) return null;
    return {
      id: r.id as string,
      contactId: r.contact_id as string,
      conversationId: r.conversation_id as string,
      service: (r.service as string) ?? null,
      startsAt: r.starts_at as string,
      endsAt: r.ends_at as string,
      status: r.status as BookingRecord["status"],
      isTest: Boolean(r.is_test),
      reminder: (r.reminder as BookingRecord["reminder"]) ?? null,
    };
  }

  async updateContactTags(contactId: string, change: { add: string[]; remove: string[] }) {
    const r = check(
      await this.db.rpc("update_contact_tags", { p_contact_id: contactId, p_add: change.add, p_remove: change.remove }),
      "update tags",
    );
    return (r as string[] | null) ?? [];
  }

  async cancelScheduledJob(jobId: string) {
    const rows = check(
      await this.db
        .from("scheduled_jobs")
        .update({ status: "cancelled", last_error: "not_needed" })
        .eq("id", jobId)
        .eq("status", "scheduled")
        .select("qstash_message_id"),
      "cancel job",
    );
    return (rows?.[0]?.qstash_message_id as string | null) ?? null;
  }

  async finishScheduledJob(jobId: string, status: ScheduledJobStatus, error?: string | null) {
    check(await this.db.from("scheduled_jobs").update({ status, last_error: error ?? null }).eq("id", jobId), "finish job");
  }

  async notify(input: NotificationInput) {
    const row = {
      kind: input.kind,
      severity: input.severity,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 2000) ?? null,
      link: input.link ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
    };
    await this.telemetry("notify", async () => {
      const { error } = await this.db.from("notifications").insert(row);
      if (error) console.warn("[notify] failed", error.message);
      await this.forwardToTelegram(input);
    });
  }

  /** Sends the alert to Telegram when a bot token is set and that alert type is switched on. Never throws. */
  private async forwardToTelegram(input: NotificationInput) {
    if (!telegramEventFor(input.kind) || !process.env.TELEGRAM_BOT_TOKEN) return;
    try {
      await forwardNotification(input, { settings: await loadSettings(), baseUrl: appUrl() });
    } catch (e) {
      console.warn("[telegram] forward failed", e instanceof Error ? e.message : String(e));
    }
  }

  async listCrmIntegrations(input: { enabledOnly: boolean; id?: string | null }) {
    let q = this.db.from("crm_integrations").select("*");
    if (input.enabledOnly) q = q.eq("enabled", true);
    if (input.id) q = q.eq("id", input.id);
    const rows = check(await q, "list integrations");
    return (rows ?? []).map(toIntegration);
  }

  async createCrmDelivery(input: { integrationId: string; leadId: string; eventId: string; eventType: string; payload: Record<string, unknown>; isTest: boolean }) {
    const { data, error } = await this.db
      .from("crm_deliveries")
      .insert({
        integration_id: input.integrationId,
        lead_id: input.leadId,
        event_id: input.eventId,
        event_type: input.eventType,
        payload: input.payload,
        is_test: input.isTest,
      })
      .select("*")
      .single();
    if (!error) return { delivery: toDelivery(data), created: true };
    if (error.code !== "23505") throw new Error(`create delivery: ${error.message}`);
    const existing = check(
      await this.db.from("crm_deliveries").select("*").eq("integration_id", input.integrationId).eq("event_id", input.eventId).single(),
      "load delivery",
    );
    return { delivery: toDelivery(existing), created: false };
  }

  async updateCrmDelivery(id: string, patch: Record<string, unknown>) {
    check(await this.db.from("crm_deliveries").update(patch).eq("id", id), "update delivery");
  }

  async setLeadCrmStatus(leadId: string, status: LeadRecord["crmSyncStatus"], syncedAt?: string | null) {
    const patch: Row = { crm_sync_status: status };
    if (syncedAt) patch.crm_last_synced_at = syncedAt;
    check(await this.db.from("leads").update(patch).eq("id", leadId), "set lead crm status");
  }

  async markCrmIntegrationResult(integrationId: string, ok: boolean, error?: string | null) {
    const now = new Date().toISOString();
    const patch: Row = ok ? { last_success_at: now, last_error: null } : { last_failure_at: now, last_error: error?.slice(0, 500) ?? null };
    await this.db.from("crm_integrations").update(patch).eq("id", integrationId);
  }
}
