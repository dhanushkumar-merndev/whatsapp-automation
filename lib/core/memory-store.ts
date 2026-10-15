import type {
  BookingRecord,
  ClaimResult,
  ContactSnapshot,
  ConversationSnapshot,
  CrmDeliveryRecord,
  CrmIntegrationRecord,
  ExecutionContext,
  ExecutionRecord,
  ExecutionStatus,
  FlowVersionRecord,
  LeadPatch,
  LeadRecord,
  MediaAssetRecord,
  NodeLogEntry,
  NotificationInput,
  OutboundClaim,
  ScheduledJobRecord,
  ScheduledJobStatus,
} from "@/lib/engine/types";
import { ACTIVE_EXECUTION_STATUSES, OPEN_LEAD_STATUSES } from "@/lib/engine/types";
import type {
  AccountRecord,
  AppStore,
  BeginTurnResult,
  FlowStatus,
  InboundProcessingStatus,
  InboundRecordInput,
  InboundRecordResult,
  PendingInbound,
  StatusUpdateInput,
  TurnState,
} from "./types";

/**
 * In-memory implementation of the persistence port. It mirrors the database
 * constraints the real store relies on (unique message ids, idempotency keys,
 * one active execution per conversation, atomic job claims, lease locks).
 * Used by the editor's simulation mode and by the automated tests.
 */

const uuid = () => globalThis.crypto.randomUUID();
const clone = <T>(v: T): T => structuredClone(v);

export interface MemoryMessage {
  id: string;
  conversationId: string;
  contactId: string;
  direction: "inbound" | "outbound";
  waMessageId: string | null;
  idempotencyKey: string | null;
  type: string;
  body: string | null;
  payload: unknown;
  mediaAssetId: string | null;
  status: string;
  processingStatus: InboundProcessingStatus | "pending" | null;
  processingNote: string | null;
  executionId: string | null;
  nodeId: string | null;
  isTest: boolean;
  providerTimestamp: string | null;
  createdAt: string;
  pricing?: { billable: boolean | null; category: string | null };
}

interface MemoryFlow {
  id: string;
  name: string;
  status: FlowStatus;
  priority: number;
  publishedVersionId: string | null;
}

export class MemoryStore implements AppStore {
  accounts = new Map<string, AccountRecord>();
  contacts = new Map<string, Omit<ContactSnapshot, "openEnquiryAt"> & { createdAt: string }>();
  conversations = new Map<string, ConversationSnapshot & { lockToken: string | null; lockExpiresAt: number }>();
  messages: MemoryMessage[] = [];
  flows = new Map<string, MemoryFlow>();
  versions = new Map<string, FlowVersionRecord>();
  executions = new Map<string, ExecutionRecord>();
  nodeLogs: NodeLogEntry[] = [];
  leads = new Map<string, LeadRecord & { answers: Record<string, unknown> }>();
  jobs = new Map<string, ScheduledJobRecord & { idempotencyKey: string }>();
  media = new Map<string, MediaAssetRecord>();
  notifications: (NotificationInput & { createdAt: string })[] = [];
  crmIntegrations = new Map<string, CrmIntegrationRecord>();
  bookings = new Map<string, BookingRecord & { calendar: string; executionId: string | null; nodeId: string | null }>();
  crmDeliveries = new Map<string, CrmDeliveryRecord & { lastError?: string | null; nextAttemptAt?: string | null }>();
  securityEvents: { scope: string; identifier: string; contactId: string | null; createdAt: string }[] = [];
  /** Mirrors app_settings.testPhoneNumbers, which the database checks when recording a message. */
  testPhoneNumbers: string[] = [];
  private tasks = new Set<Promise<unknown>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  private iso() {
    return this.now().toISOString();
  }

  // --- Setup helpers (tests / simulator) ------------------------------------

  addAccount(input: Partial<AccountRecord> & { phoneNumberId: string }): AccountRecord {
    const acc: AccountRecord = { id: uuid(), name: "Main", wabaId: "waba", enabled: true, ...input };
    this.accounts.set(acc.id, acc);
    return acc;
  }

  addFlow(input: { name: string; status: FlowStatus; priority?: number; definition: FlowVersionRecord["definition"] }) {
    const flowId = uuid();
    const versionId = uuid();
    this.versions.set(versionId, { id: versionId, flowId, flowName: input.name, version: 1, definition: clone(input.definition) });
    this.flows.set(flowId, { id: flowId, name: input.name, status: input.status, priority: input.priority ?? 100, publishedVersionId: versionId });
    return { flowId, versionId };
  }

  publishVersion(flowId: string, definition: FlowVersionRecord["definition"]) {
    const flow = this.flows.get(flowId)!;
    const versions = [...this.versions.values()].filter((v) => v.flowId === flowId);
    const id = uuid();
    this.versions.set(id, { id, flowId, flowName: flow.name, version: versions.length + 1, definition: clone(definition) });
    flow.publishedVersionId = id;
    return id;
  }

  setFlowStatus(flowId: string, status: FlowStatus) {
    this.flows.get(flowId)!.status = status;
  }

  /** Mirrors the Pause action: cancels the flow's delayed steps and parks its open chats. */
  stopFlowRuns(flowId: string) {
    for (const j of this.jobs.values()) if (j.flowId === flowId && j.status === "scheduled") j.status = "cancelled";
    for (const e of this.executions.values()) {
      if (e.flowId === flowId && (e.status === "waiting_input" || e.status === "waiting_delay")) {
        e.status = "paused";
        e.awaiting = null;
        e.completedAt = this.iso();
      }
    }
  }

  addMedia(asset: Partial<MediaAssetRecord> & { name: string }): MediaAssetRecord {
    const rec: MediaAssetRecord = {
      id: uuid(),
      kind: "document",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      storagePath: `media/${uuid()}.pdf`,
      status: "ready",
      metaMediaId: null,
      metaMediaUploadedAt: null,
      metaPhoneNumberId: null,
      deletedAt: null,
      ...asset,
    };
    this.media.set(rec.id, rec);
    return rec;
  }

  addCrmIntegration(input: Partial<CrmIntegrationRecord> & { url: string }): CrmIntegrationRecord {
    const rec: CrmIntegrationRecord = {
      id: uuid(),
      name: "CRM",
      enabled: true,
      authType: "none",
      credentials: {},
      signingSecret: "secret",
      fieldMapping: {},
      ...input,
    };
    this.crmIntegrations.set(rec.id, rec);
    return rec;
  }

  /** Simulator helper: make a contact look like a returning customer. */
  seedPriorExecution(contactId: string, conversationId: string, flowId: string, versionId: string) {
    const now = this.iso();
    const id = uuid();
    this.executions.set(id, {
      id,
      flowId,
      flowVersionId: versionId,
      conversationId,
      contactId,
      status: "completed",
      currentNodeId: null,
      step: 0,
      context: { vars: {}, attempts: {}, lastQuestionNodeId: null, isNewCustomer: true, leadId: null, path: [] },
      awaiting: null,
      isTest: true,
      error: null,
      startedAt: now,
      lastActivityAt: now,
      completedAt: now,
    });
  }

  outbound(conversationId?: string) {
    return this.messages.filter((m) => m.direction === "outbound" && (!conversationId || m.conversationId === conversationId));
  }

  // --- Inbound ------------------------------------------------------------------

  async recordInbound(input: InboundRecordInput): Promise<InboundRecordResult> {
    const account = input.accountId
      ? this.accounts.get(input.accountId)
      : [...this.accounts.values()].find(
          (a) => a.phoneNumberId === input.phoneNumberId && a.enabled && (!input.wabaId || a.wabaId === input.wabaId),
        );
    if (!account) return { ignored: "unknown_account" };
    input = { ...input, accountId: account.id, isTest: input.isTest || this.testPhoneNumbers.includes(input.waId) };
    let contact = [...this.contacts.values()].find((c) => c.waId === input.waId);
    let newContact = false;
    if (!contact) {
      newContact = true;
      contact = {
        id: uuid(),
        waId: input.waId,
        name: null,
        profileName: input.profileName,
        businessName: null,
        email: null,
        optedOut: false,
        cooldownUntil: null,
        isTest: input.isTest,
        createdAt: this.iso(),
      };
      this.contacts.set(contact.id, contact);
    } else if (input.profileName) {
      contact.profileName = input.profileName;
    }
    let conv = [...this.conversations.values()].find((c) => c.contactId === contact!.id && c.accountId === account.id);
    if (!conv) {
      conv = {
        id: uuid(),
        contactId: contact.id,
        accountId: account.id,
        phoneNumberId: account.phoneNumberId,
        status: "open",
        lastInboundAt: input.providerTimestamp,
        isTest: input.isTest,
        lockToken: null,
        lockExpiresAt: 0,
      };
      this.conversations.set(conv.id, conv);
    } else if (!conv.lastInboundAt || conv.lastInboundAt < input.providerTimestamp) {
      conv.lastInboundAt = input.providerTimestamp;
    }
    const result = {
      accountId: account.id,
      contactId: contact.id,
      conversationId: conv.id,
      conversationStatus: conv.status,
      optedOut: contact.optedOut,
      cooldownUntil: contact.cooldownUntil,
      isTest: input.isTest,
      newContact,
    };
    if (this.messages.some((m) => m.waMessageId === input.waMessageId)) {
      return { ...result, messageId: null, duplicate: true };
    }
    const msg: MemoryMessage = {
      id: uuid(),
      conversationId: conv.id,
      contactId: contact.id,
      direction: "inbound",
      waMessageId: input.waMessageId,
      idempotencyKey: null,
      type: input.type,
      body: input.body,
      payload: input.payload,
      mediaAssetId: null,
      status: "received",
      processingStatus: "pending",
      processingNote: null,
      executionId: null,
      nodeId: null,
      isTest: input.isTest,
      providerTimestamp: input.providerTimestamp,
      createdAt: this.iso(),
    };
    this.messages.push(msg);
    return { ...result, messageId: msg.id, duplicate: false };
  }

  async applyStatus(input: StatusUpdateInput) {
    const m = this.messages.find((x) => x.waMessageId === input.waMessageId && x.direction === "outbound");
    if (!m) return false;
    const rank = (s: string) => ({ sent: 1, delivered: 2, read: 3, failed: 9 })[s] ?? 0;
    if (input.status === "failed" || rank(input.status) > rank(m.status)) m.status = input.status;
    m.pricing = { billable: input.billable, category: input.category };
    return true;
  }

  async acquireLock(conversationId: string, token: string, ttlSeconds: number) {
    const c = this.conversations.get(conversationId);
    if (!c) return false;
    const now = this.now().getTime();
    if (c.lockToken && c.lockToken !== token && c.lockExpiresAt > now) return false;
    c.lockToken = token;
    c.lockExpiresAt = now + ttlSeconds * 1000;
    return true;
  }

  async beginTurn(conversationId: string, token: string, ttlSeconds: number, limit: number): Promise<BeginTurnResult> {
    if (!(await this.acquireLock(conversationId, token, ttlSeconds))) return { locked: false };
    return { locked: true, pending: await this.listPendingInbound(conversationId, limit), state: await this.getTurnState(conversationId) };
  }

  async getTurnState(conversationId: string): Promise<TurnState | null> {
    const ctx = await this.getConversationContext(conversationId);
    if (!ctx) return null;
    const active = await this.getActiveExecution(conversationId);
    const ended = [...this.executions.values()]
      .filter((e) => e.conversationId === conversationId && e.completedAt && !ACTIVE_EXECUTION_STATUSES.includes(e.status))
      .map((e) => e.completedAt!)
      .sort();
    const candidates = [...this.flows.values()]
      .filter((f) => f.publishedVersionId && (f.status === "active" || (ctx.conversation.isTest && f.status === "testing")))
      .map((f) => {
        const v = this.versions.get(f.publishedVersionId!)!;
        return { flowId: f.id, flowName: f.name, status: f.status, priority: f.priority, versionId: v.id, version: v.version };
      });
    return {
      ...ctx,
      active,
      activeFlowStatus: active ? (this.flows.get(active.flowId)?.status ?? null) : null,
      lastCompletedAt: ended.at(-1) ?? null,
      candidates,
      priorExecutions: [...this.executions.values()].filter((e) => e.contactId === ctx.contact.id).length,
    };
  }

  async releaseLock(conversationId: string, token: string) {
    const c = this.conversations.get(conversationId);
    if (c && c.lockToken === token) {
      c.lockToken = null;
      c.lockExpiresAt = 0;
    }
  }

  async listPendingInbound(conversationId: string, limit: number): Promise<PendingInbound[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId && m.direction === "inbound" && m.processingStatus === "pending")
      .sort((a, b) => (a.providerTimestamp ?? "").localeCompare(b.providerTimestamp ?? "") || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        waMessageId: m.waMessageId!,
        type: m.type,
        body: m.body,
        payload: (m.payload ?? {}) as Record<string, unknown>,
        providerTimestamp: m.providerTimestamp!,
      }));
  }

  async markInbound(messageId: string, status: InboundProcessingStatus, note?: string | null, executionId?: string | null) {
    const m = this.messages.find((x) => x.id === messageId);
    if (m) {
      m.processingStatus = status;
      m.processingNote = note ?? null;
      m.executionId = executionId ?? m.executionId;
    }
  }

  async getConversationContext(conversationId: string) {
    const conv = this.conversations.get(conversationId);
    if (!conv) return null;
    const contact = this.contacts.get(conv.contactId)!;
    const { lockToken: _l, lockExpiresAt: _e, ...conversation } = conv;
    const { createdAt: _c, ...c } = contact;
    const open = [...this.leads.values()]
      .filter((l) => l.contactId === c.id && OPEN_LEAD_STATUSES.includes(l.status))
      .map((l) => l.createdAt)
      .sort();
    return { conversation: clone(conversation), contact: clone({ ...c, openEnquiryAt: open.at(-1) ?? null }) };
  }

  async getActiveExecution(conversationId: string) {
    const e = [...this.executions.values()].find(
      (x) => x.conversationId === conversationId && ACTIVE_EXECUTION_STATUSES.includes(x.status),
    );
    return e ? clone(e) : null;
  }

  async getExecution(id: string) {
    const e = this.executions.get(id);
    return e ? clone(e) : null;
  }

  async getFlowVersion(versionId: string) {
    const v = this.versions.get(versionId);
    return v ? clone(v) : null;
  }

  async getFlowStatus(flowId: string) {
    return this.flows.get(flowId)?.status ?? null;
  }

  async setExecutionStatus(id: string, status: ExecutionStatus, error?: string | null) {
    const e = this.executions.get(id);
    if (e) {
      e.status = status;
      e.awaiting = null;
      e.error = error ?? e.error;
      e.completedAt = this.iso();
    }
  }

  async cancelJobsForExecution(executionId: string) {
    const ids: string[] = [];
    for (const j of this.jobs.values()) {
      if (j.executionId === executionId && j.status === "scheduled") {
        j.status = "cancelled";
        if (j.qstashMessageId) ids.push(j.qstashMessageId);
      }
    }
    return ids;
  }

  async getScheduledJob(id: string) {
    const j = this.jobs.get(id);
    return j ? clone(j) : null;
  }

  async claimScheduledJob(id: string) {
    const j = this.jobs.get(id);
    if (!j || j.status !== "scheduled") return null;
    j.status = "running";
    j.attempts += 1;
    return clone(j);
  }

  async getCrmDelivery(id: string) {
    const d = this.crmDeliveries.get(id);
    return d ? clone(d) : null;
  }

  async recordSecurityEvent(input: { scope: string; identifier: string; contactId?: string | null }) {
    this.securityEvents.push({ scope: input.scope, identifier: input.identifier, contactId: input.contactId ?? null, createdAt: this.iso() });
  }

  async countRecentSecurityEvents(scope: string, contactId: string, sinceIso: string) {
    return this.securityEvents.filter((e) => e.scope === scope && e.contactId === contactId && e.createdAt >= sinceIso).length;
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
    if (await this.getActiveExecution(input.conversationId)) return null;
    const now = this.iso();
    const exec: ExecutionRecord = {
      id: uuid(),
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      status: "running",
      currentNodeId: input.currentNodeId,
      step: 0,
      context: clone(input.context),
      awaiting: null,
      isTest: input.isTest,
      error: null,
      startedAt: now,
      lastActivityAt: now,
      completedAt: null,
    };
    this.executions.set(exec.id, exec);
    return clone(exec);
  }

  async saveExecution(exec: ExecutionRecord) {
    this.executions.set(exec.id, clone(exec));
  }

  async logNode(entry: NodeLogEntry) {
    this.nodeLogs.push(clone(entry));
  }

  async claimOutbound(claim: OutboundClaim): Promise<ClaimResult> {
    const existing = this.messages.find((m) => m.idempotencyKey === claim.idempotencyKey);
    if (existing) return { status: "duplicate", existingStatus: existing.status };
    const msg: MemoryMessage = {
      id: uuid(),
      conversationId: claim.conversationId,
      contactId: claim.contactId,
      direction: "outbound",
      waMessageId: null,
      idempotencyKey: claim.idempotencyKey,
      type: claim.message.kind === "media" ? claim.message.mediaType : claim.message.kind === "text" ? "text" : "interactive",
      body: claim.preview,
      payload: claim.message,
      mediaAssetId: claim.mediaAssetId,
      status: "pending",
      processingStatus: null,
      processingNote: null,
      executionId: claim.executionId,
      nodeId: claim.nodeId,
      isTest: claim.isTest,
      providerTimestamp: null,
      createdAt: this.iso(),
    };
    this.messages.push(msg);
    return { status: "new", messageId: msg.id };
  }

  async completeOutbound(key: string, result: { waMessageId: string } | { error: string; skipped?: boolean }) {
    const m = this.messages.find((x) => x.idempotencyKey === key);
    if (!m) return;
    if ("waMessageId" in result) {
      m.waMessageId = result.waMessageId;
      m.status = "sent";
    } else {
      m.status = result.skipped ? "skipped" : "failed";
      m.processingNote = result.error;
    }
  }

  async hasRecentNodeSend(contactId: string, flowId: string, nodeId: string, sinceIso: string) {
    return this.messages.some(
      (m) =>
        m.direction === "outbound" &&
        m.contactId === contactId &&
        m.nodeId === nodeId &&
        m.executionId !== null &&
        this.executions.get(m.executionId)?.flowId === flowId &&
        m.createdAt >= sinceIso &&
        ["sent", "delivered", "read", "pending"].includes(m.status),
    );
  }

  async hasRecentMediaSend(contactId: string, assetId: string, sinceIso: string) {
    return this.messages.some(
      (m) =>
        m.direction === "outbound" &&
        m.contactId === contactId &&
        m.mediaAssetId === assetId &&
        m.createdAt >= sinceIso &&
        ["sent", "delivered", "read", "pending"].includes(m.status),
    );
  }

  async getMediaAsset(id: string) {
    const a = this.media.get(id);
    return a ? clone(a) : null;
  }

  async upsertLead(input: { execution: ExecutionRecord; conversation: ConversationSnapshot; contact: ContactSnapshot; patch: LeadPatch }) {
    let lead = [...this.leads.values()].find((l) => l.flowExecutionId === input.execution.id);
    const now = this.iso();
    if (!lead) {
      lead = {
        id: uuid(),
        contactId: input.contact.id,
        conversationId: input.conversation.id,
        flowId: input.execution.flowId,
        flowExecutionId: input.execution.id,
        name: null,
        businessName: null,
        service: null,
        serviceId: null,
        requirements: null,
        email: null,
        phone: input.contact.waId,
        status: "incomplete",
        crmSyncStatus: "pending",
        isTest: input.execution.isTest,
        createdAt: now,
        updatedAt: now,
        answers: {},
      };
      this.leads.set(lead.id, lead);
    }
    const p = input.patch;
    if (p.name !== undefined) lead.name = p.name;
    if (p.business_name !== undefined) lead.businessName = p.business_name;
    if (p.service !== undefined) lead.service = p.service;
    if (p.service_id !== undefined) lead.serviceId = p.service_id;
    if (p.requirements !== undefined) lead.requirements = p.requirements;
    if (p.email !== undefined) lead.email = p.email;
    if (p.status) lead.status = p.status;
    if (p.answers) lead.answers = { ...lead.answers, ...p.answers };
    lead.updatedAt = now;
    const { answers: _a, ...rest } = lead;
    return clone(rest);
  }

  async getLead(id: string) {
    const l = this.leads.get(id);
    if (!l) return null;
    const { answers: _a, ...rest } = l;
    return clone(rest);
  }

  async updateContact(
    id: string,
    patch: Partial<{ name: string | null; business_name: string | null; email: string | null; opted_out: boolean; cooldown_until: string | null }>,
  ) {
    const c = this.contacts.get(id);
    if (!c) return;
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.business_name !== undefined) c.businessName = patch.business_name;
    if (patch.email !== undefined) c.email = patch.email;
    if (patch.opted_out !== undefined) c.optedOut = patch.opted_out;
    if (patch.cooldown_until !== undefined) c.cooldownUntil = patch.cooldown_until;
  }

  async updateConversation(id: string, patch: Partial<{ status: "open" | "handoff" | "closed" }>) {
    const c = this.conversations.get(id);
    if (c && patch.status) c.status = patch.status;
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
    const existing = [...this.jobs.values()].find((j) => j.idempotencyKey === input.idempotencyKey);
    if (existing) return { job: clone(existing), created: false };
    const job = {
      id: uuid(),
      kind: input.kind,
      executionId: input.executionId,
      conversationId: input.conversationId,
      nodeId: input.nodeId,
      crmDeliveryId: input.crmDeliveryId,
      flowId: input.flowId,
      bookingId: input.bookingId ?? null,
      runAt: input.runAt,
      status: "scheduled" as ScheduledJobStatus,
      qstashMessageId: null,
      attempts: 0,
      lastError: null,
      isTest: input.isTest,
      idempotencyKey: input.idempotencyKey,
    };
    this.jobs.set(job.id, job);
    return { job: clone(job), created: true };
  }

  async attachJobMessage(jobId: string, qstashMessageId: string | null) {
    const j = this.jobs.get(jobId);
    if (j) j.qstashMessageId = qstashMessageId;
  }

  private activeBooking = (b: { status: string }) => b.status === "booked" || b.status === "confirmed";

  async countBookings(input: { calendar: string; fromIso: string; toIso: string }) {
    const out = new Map<number, number>();
    for (const b of this.bookings.values()) {
      if (b.calendar !== input.calendar || !this.activeBooking(b) || b.startsAt < input.fromIso || b.startsAt > input.toIso) continue;
      const t = new Date(b.startsAt).getTime();
      out.set(t, (out.get(t) ?? 0) + 1);
    }
    return out;
  }

  async createBooking(input: Parameters<AppStore["createBooking"]>[0]): Promise<{ ok: true; id: string } | { ok: false }> {
    const mine = [...this.bookings.values()].find((b) => b.executionId === input.execution.id && b.nodeId === input.nodeId && this.activeBooking(b));
    if (mine) return { ok: true, id: mine.id };
    const taken = [...this.bookings.values()].filter((b) => b.calendar === input.calendar && b.startsAt === input.startsAt && this.activeBooking(b)).length;
    if (taken >= input.capacity) return { ok: false };
    const id = uuid();
    this.bookings.set(id, {
      id,
      calendar: input.calendar,
      executionId: input.execution.id,
      nodeId: input.nodeId,
      contactId: input.contact.id,
      conversationId: input.conversation.id,
      service: input.service,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "booked",
      isTest: input.execution.isTest,
      reminder: input.reminder,
    });
    return { ok: true, id };
  }

  async getBooking(id: string) {
    const b = this.bookings.get(id);
    return b ? clone(b) : null;
  }

  async cancelScheduledJob(jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j || j.status !== "scheduled") return null;
    j.status = "cancelled";
    j.lastError = "not_needed";
    return j.qstashMessageId;
  }

  async finishScheduledJob(jobId: string, status: ScheduledJobStatus, error?: string | null) {
    const j = this.jobs.get(jobId);
    if (j) {
      j.status = status;
      j.lastError = error ?? null;
    }
  }

  async notify(input: NotificationInput) {
    this.notifications.push({ ...input, createdAt: this.iso() });
  }

  /** Every write here is synchronous. */
  background(_what: string, task: () => Promise<unknown>) {
    const p: Promise<unknown> = task()
      .catch(() => undefined)
      .finally(() => this.tasks.delete(p));
    this.tasks.add(p);
  }

  async flush() {
    while (this.tasks.size) await Promise.all([...this.tasks]);
  }

  async listCrmIntegrations(input: { enabledOnly: boolean; id?: string | null }) {
    return [...this.crmIntegrations.values()]
      .filter((i) => (!input.enabledOnly || i.enabled) && (!input.id || i.id === input.id))
      .map(clone);
  }

  async createCrmDelivery(input: {
    integrationId: string;
    leadId: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    isTest: boolean;
  }) {
    const existing = [...this.crmDeliveries.values()].find((d) => d.integrationId === input.integrationId && d.eventId === input.eventId);
    if (existing) return { delivery: clone(existing), created: false };
    const d: CrmDeliveryRecord = {
      id: uuid(),
      integrationId: input.integrationId,
      leadId: input.leadId,
      eventId: input.eventId,
      eventType: input.eventType,
      payload: clone(input.payload),
      status: "pending",
      attempts: 0,
      maxAttempts: 6,
      isTest: input.isTest,
    };
    this.crmDeliveries.set(d.id, d);
    return { delivery: clone(d), created: true };
  }

  async updateCrmDelivery(id: string, patch: Partial<{ status: CrmDeliveryRecord["status"]; attempts: number; last_error: string | null; next_attempt_at: string | null }>) {
    const d = this.crmDeliveries.get(id);
    if (!d) return;
    if (patch.status) d.status = patch.status;
    if (patch.attempts !== undefined) d.attempts = patch.attempts;
    if (patch.last_error !== undefined) d.lastError = patch.last_error;
    if (patch.next_attempt_at !== undefined) d.nextAttemptAt = patch.next_attempt_at;
  }

  async setLeadCrmStatus(leadId: string, status: LeadRecord["crmSyncStatus"]) {
    const l = this.leads.get(leadId);
    if (l) l.crmSyncStatus = status;
  }

  async markCrmIntegrationResult() {}
}
