import type { FlowDefinition, NodeType } from "./schema";
import type { AppSettings } from "@/lib/settings/schema";

// ---------------------------------------------------------------------------
// Runtime records
// ---------------------------------------------------------------------------

export const EXECUTION_STATUSES = [
  "running",
  "waiting_input",
  "waiting_delay",
  "completed",
  "handoff",
  "window_expired",
  "failed",
  "cancelled",
  "paused",
  "abandoned",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export const ACTIVE_EXECUTION_STATUSES: readonly ExecutionStatus[] = ["running", "waiting_input", "waiting_delay"];

export interface InboundInput {
  type: string;
  text: string;
  /** Interactive reply id (button_reply / list_reply / quick-reply payload). */
  replyId?: string;
  replyTitle?: string;
  /** The message a tap answers (WhatsApp's context id): tells which question's buttons were tapped. */
  contextId?: string;
  messageId?: string;
  /** Photo, file, video, voice note or sticker. */
  media?: { type: string; mediaId: string | null; mimeType: string | null; filename: string | null; caption: string | null };
  location?: { latitude: number; longitude: number; name: string | null; address: string | null };
  /** Answers from a WhatsApp Form (Meta Flow) submission. */
  form?: Record<string, unknown>;
}

export type OutboundMessage =
  | { kind: "text"; text: string }
  | { kind: "media"; mediaType: "document" | "image" | "video"; assetId: string; caption?: string; filename?: string }
  | {
      kind: "buttons";
      body: string;
      header?: string;
      footer?: string;
      buttons: { id: string; title: string }[];
    }
  | {
      kind: "list";
      body: string;
      header?: string;
      footer?: string;
      buttonText: string;
      rows: { id: string; title: string; description?: string }[];
    }
  | { kind: "cta_url"; body: string; buttonText: string; url: string }
  | { kind: "location"; latitude: number; longitude: number; name?: string; address?: string }
  | { kind: "flow"; body: string; header?: string; footer?: string; flowId: string; cta: string; screen: string; flowToken: string; draft: boolean }
  /** An approved WhatsApp template; the only kind allowed outside the 24-hour window. */
  | { kind: "template"; name: string; language: string; bodyParams: string[] };

export interface ContactSnapshot {
  id: string;
  waId: string;
  name: string | null;
  profileName: string | null;
  businessName: string | null;
  email: string | null;
  optedOut: boolean;
  cooldownUntil: string | null;
  isTest: boolean;
  /** When the customer's latest still-open enquiry (lead new/qualified/contacted) was created, if any. */
  openEnquiryAt: string | null;
  tags: string[];
}

export interface ConversationSnapshot {
  id: string;
  contactId: string;
  accountId: string;
  phoneNumberId: string;
  status: "open" | "handoff" | "closed";
  lastInboundAt: string | null;
  isTest: boolean;
  /** Who handed the chat to a person, and when a person last replied (phone app or dashboard). */
  handoffBy?: "customer" | "flow" | "team" | "business_app" | "telegram" | null;
  handoffAt?: string | null;
  humanLastReplyAt?: string | null;
}

export interface ExecutionContext {
  vars: Record<string, unknown>;
  /** Invalid-answer counter per validation node. */
  attempts: Record<string, number>;
  lastQuestionNodeId: string | null;
  isNewCustomer: boolean;
  leadId: string | null;
  /** Node ids visited, in order (capped) — used for the progress diagram. */
  path: string[];
  /** Button/list messages sent in this run: WhatsApp message id → question node id (capped). */
  prompts?: Record<string, string>;
}

export type Awaiting =
  /** `since`: when the question was sent; messages written before it are not taken as the answer. */
  | { kind: "input"; nodeId: string; questionNodeId: string; since?: string; timeoutJobId?: string | null }
  | { kind: "delay"; nodeId: string; jobId: string | null };

export interface ExecutionRecord {
  id: string;
  flowId: string;
  flowVersionId: string;
  conversationId: string;
  contactId: string;
  status: ExecutionStatus;
  currentNodeId: string | null;
  step: number;
  context: ExecutionContext;
  awaiting: Awaiting | null;
  isTest: boolean;
  error: string | null;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}

export interface FlowVersionRecord {
  id: string;
  flowId: string;
  flowName: string;
  version: number;
  definition: FlowDefinition;
}

export type NodeRunStatus = "success" | "waiting" | "skipped" | "failed";

export interface NodeLogEntry {
  executionId: string;
  nodeId: string;
  nodeType: NodeType;
  step: number;
  status: NodeRunStatus;
  outputHandle?: string | null;
  detail?: Record<string, unknown>;
  error?: string | null;
  durationMs?: number;
}

export interface OutboundClaim {
  idempotencyKey: string;
  conversationId: string;
  contactId: string;
  executionId: string | null;
  nodeId: string | null;
  message: OutboundMessage;
  /** Human-readable preview stored as the message body. */
  preview: string;
  mediaAssetId: string | null;
  isTest: boolean;
  sentBy?: string | null;
}

export type ClaimResult = { status: "new"; messageId: string } | { status: "duplicate"; existingStatus: string };

export interface MediaAssetRecord {
  id: string;
  name: string;
  kind: "image" | "document" | "video";
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  status: "pending" | "ready" | "rejected";
  metaMediaId: string | null;
  metaMediaUploadedAt: string | null;
  metaPhoneNumberId: string | null;
  deletedAt: string | null;
}

export type LeadStatus = "incomplete" | "new" | "qualified" | "contacted" | "won" | "lost" | "closed";
/** Submitted enquiries the team has not closed yet. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ["new", "qualified", "contacted"];

export interface LeadPatch {
  name?: string | null;
  business_name?: string | null;
  service?: string | null;
  service_id?: string | null;
  requirements?: string | null;
  email?: string | null;
  status?: LeadStatus;
  answers?: Record<string, unknown>;
}

export interface LeadRecord {
  id: string;
  contactId: string;
  conversationId: string;
  flowId: string | null;
  flowExecutionId: string | null;
  name: string | null;
  businessName: string | null;
  service: string | null;
  serviceId: string | null;
  requirements: string | null;
  email: string | null;
  phone: string;
  status: LeadStatus;
  crmSyncStatus: "not_configured" | "pending" | "synced" | "failed";
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ScheduledJobKind = "flow_resume" | "crm_retry" | "input_timeout" | "booking_reminder";

export interface BookingRecord {
  id: string;
  contactId: string;
  conversationId: string;
  service: string | null;
  startsAt: string;
  endsAt: string;
  status: "booked" | "confirmed" | "cancelled" | "completed" | "no_show";
  isTest: boolean;
  /** Rendered when booking: the text reminder and the template fallback. */
  reminder: { text: string; template: string; language: string; params: string[] } | null;
}
export type ScheduledJobStatus = "scheduled" | "running" | "completed" | "cancelled" | "failed" | "skipped";

export interface ScheduledJobRecord {
  id: string;
  kind: ScheduledJobKind;
  executionId: string | null;
  conversationId: string | null;
  nodeId: string | null;
  crmDeliveryId: string | null;
  flowId: string | null;
  bookingId?: string | null;
  runAt: string;
  status: ScheduledJobStatus;
  qstashMessageId: string | null;
  attempts: number;
  lastError: string | null;
  isTest: boolean;
}

export type CrmAuthType = "none" | "bearer" | "basic" | "header";

export interface CrmCredentials {
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
}

export interface CrmIntegrationRecord {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authType: CrmAuthType;
  /** Decrypted server-side only; never sent to the browser. */
  credentials: CrmCredentials;
  signingSecret: string | null;
  fieldMapping: Record<string, string>;
}

export type CrmDeliveryStatus = "pending" | "succeeded" | "failed" | "retrying" | "deferred";

export interface CrmDeliveryRecord {
  id: string;
  integrationId: string;
  leadId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: CrmDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  isTest: boolean;
}

export interface NotificationInput {
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** The chat this alert is about: Telegram alerts then get action buttons. */
  conversationId?: string;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export class SendError extends Error {
  constructor(
    message: string,
    readonly opts: { code?: string | number; windowClosed?: boolean; transient?: boolean } = {},
  ) {
    super(message);
    this.name = "SendError";
  }
}

export interface MessageSender {
  send(input: {
    to: string;
    phoneNumberId: string;
    message: OutboundMessage;
    asset?: MediaAssetRecord | null;
  }): Promise<{ waMessageId: string }>;
  /** Marks a customer message as read and shows "typing…" until the next reply (max ~25 s). */
  markRead?(input: { phoneNumberId: string; waMessageId: string }): Promise<void>;
}

export interface Scheduler {
  schedule(input: { jobId: string; delaySeconds: number }): Promise<{ messageId: string | null }>;
  cancel(messageId: string): Promise<void>;
}

export interface CrmDeliveryResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  responseExcerpt: string | null;
  durationMs: number;
  /** false for permanent failures (e.g. blocked destination, 4xx) — do not retry. */
  retryable: boolean;
}

export interface CrmDispatcher {
  deliver(integration: CrmIntegrationRecord, delivery: CrmDeliveryRecord): Promise<CrmDeliveryResult>;
}

/** Persistence used by the flow engine. */
export interface EngineStore {
  createExecution(input: {
    flowId: string;
    flowVersionId: string;
    conversationId: string;
    contactId: string;
    isTest: boolean;
    context: ExecutionContext;
    currentNodeId: string;
  }): Promise<ExecutionRecord | null>;
  saveExecution(exec: ExecutionRecord): Promise<void>;
  logNode(entry: NodeLogEntry): Promise<void>;

  claimOutbound(claim: OutboundClaim): Promise<ClaimResult>;
  completeOutbound(idempotencyKey: string, result: { waMessageId: string } | { error: string; skipped?: boolean }): Promise<void>;

  hasRecentMediaSend(contactId: string, assetId: string, sinceIso: string): Promise<boolean>;

  /** Active bookings per slot start (epoch ms) on a calendar, for availability. */
  countBookings(input: { calendar: string; fromIso: string; toIso: string }): Promise<Map<number, number>>;
  /** Books a slot unless it is full (atomic). */
  createBooking(input: {
    calendar: string;
    capacity: number;
    execution: ExecutionRecord;
    nodeId: string;
    conversation: ConversationSnapshot;
    contact: ContactSnapshot;
    service: string | null;
    startsAt: string;
    endsAt: string;
    timezone: string;
    reminder: BookingRecord["reminder"];
  }): Promise<{ ok: true; id: string } | { ok: false }>;
  getBooking(id: string): Promise<BookingRecord | null>;
  /** Adds and removes contact tags; returns the tags afterwards. */
  updateContactTags(contactId: string, change: { add: string[]; remove: string[] }): Promise<string[]>;
  /** Whether this flow node already messaged the contact since the given time. */
  hasRecentNodeSend(contactId: string, flowId: string, nodeId: string, sinceIso: string): Promise<boolean>;
  getMediaAsset(id: string): Promise<MediaAssetRecord | null>;

  upsertLead(input: {
    execution: ExecutionRecord;
    conversation: ConversationSnapshot;
    contact: ContactSnapshot;
    patch: LeadPatch;
  }): Promise<LeadRecord>;
  getLead(id: string): Promise<LeadRecord | null>;
  updateContact(id: string, patch: Partial<{ name: string | null; business_name: string | null; email: string | null; opted_out: boolean; cooldown_until: string | null }>): Promise<void>;
  updateConversation(
    id: string,
    patch: Partial<{
      status: "open" | "handoff" | "closed";
      handoff_reason: string | null;
      handoff_at: string | null;
      handoff_by: NonNullable<ConversationSnapshot["handoffBy"]> | null;
    }>,
  ): Promise<void>;

  createScheduledJob(input: {
    kind: ScheduledJobKind;
    executionId: string | null;
    conversationId: string | null;
    nodeId: string | null;
    crmDeliveryId: string | null;
    flowId: string | null;
    runAt: string;
    idempotencyKey: string;
    isTest: boolean;
    bookingId?: string | null;
  }): Promise<{ job: ScheduledJobRecord; created: boolean }>;
  attachJobMessage(jobId: string, qstashMessageId: string | null): Promise<void>;
  /** Cancels a job that is still scheduled; returns its QStash message id to cancel there too. */
  cancelScheduledJob(jobId: string): Promise<string | null>;
  finishScheduledJob(jobId: string, status: ScheduledJobStatus, error?: string | null): Promise<void>;

  notify(input: NotificationInput): Promise<void>;

  listCrmIntegrations(input: { enabledOnly: boolean; id?: string | null }): Promise<CrmIntegrationRecord[]>;
  createCrmDelivery(input: {
    integrationId: string;
    leadId: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    isTest: boolean;
  }): Promise<{ delivery: CrmDeliveryRecord; created: boolean }>;
  updateCrmDelivery(
    id: string,
    patch: Partial<{
      status: CrmDeliveryStatus;
      attempts: number;
      last_status_code: number | null;
      last_error: string | null;
      response_excerpt: string | null;
      next_attempt_at: string | null;
      delivered_at: string | null;
    }>,
  ): Promise<void>;
  setLeadCrmStatus(leadId: string, status: LeadRecord["crmSyncStatus"], syncedAt?: string | null): Promise<void>;
  markCrmIntegrationResult(integrationId: string, ok: boolean, error?: string | null): Promise<void>;
}

export interface EngineLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface EngineDeps {
  store: EngineStore;
  sender: MessageSender;
  scheduler: Scheduler;
  crm: CrmDispatcher;
  settings: AppSettings;
  now: () => Date;
  logger: EngineLogger;
  /** Simulation mode never sends live messages and never creates production leads. */
  mode: "live" | "simulation";
  /**
   * When set, short Wait steps pause inside the request instead of going through
   * QStash. The budget is shared by every run in one request (function time limit).
   */
  inlineWait?: { sleep: (ms: number) => Promise<void>; budgetMs: number };
  /** Outgoing HTTP for the "API request" step (public addresses only). Absent in simulation. */
  http?: HttpPort;
}

export interface HttpPort {
  request(input: { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string; timeoutMs: number }): Promise<{ status: number; body: string }>;
}

export const silentLogger: EngineLogger = { info() {}, warn() {}, error() {} };
