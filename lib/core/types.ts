import type {
  ContactSnapshot,
  ConversationSnapshot,
  CrmDeliveryRecord,
  EngineStore,
  ExecutionRecord,
  ExecutionStatus,
  FlowVersionRecord,
  ScheduledJobRecord,
} from "@/lib/engine/types";
import type { FlowDefinition } from "@/lib/engine/schema";

export type FlowStatus = "draft" | "testing" | "active" | "paused" | "archived";

export interface AccountRecord {
  id: string;
  name: string;
  wabaId: string;
  phoneNumberId: string;
  enabled: boolean;
}

export interface InboundRecordInput {
  accountId: string;
  waId: string;
  profileName: string | null;
  waMessageId: string;
  type: string;
  body: string | null;
  payload: Record<string, unknown>;
  providerTimestamp: string;
  isTest: boolean;
}

export interface InboundRecordResult {
  contactId: string;
  conversationId: string;
  messageId: string | null;
  duplicate: boolean;
  newContact: boolean;
}

export interface PendingInbound {
  id: string;
  waMessageId: string;
  type: string;
  body: string | null;
  payload: Record<string, unknown>;
  providerTimestamp: string;
}

export interface StatusUpdateInput {
  waMessageId: string;
  status: string;
  error: Record<string, unknown> | null;
  billable: boolean | null;
  category: string | null;
  model: string | null;
}

export interface TriggerCandidateRecord {
  flowId: string;
  flowName: string;
  status: FlowStatus;
  priority: number;
  versionId: string;
  version: number;
  definition: FlowDefinition;
}

export type InboundProcessingStatus = "processed" | "rate_limited" | "ignored" | "failed";

/** Everything the webhook/worker pipeline needs from persistence. */
export interface AppStore extends EngineStore {
  getAccountByPhoneNumberId(phoneNumberId: string): Promise<AccountRecord | null>;
  recordInbound(input: InboundRecordInput): Promise<InboundRecordResult>;
  applyStatus(input: StatusUpdateInput): Promise<boolean>;

  acquireLock(conversationId: string, token: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(conversationId: string, token: string): Promise<void>;
  listPendingInbound(conversationId: string, limit: number): Promise<PendingInbound[]>;
  markInbound(messageId: string, status: InboundProcessingStatus, note?: string | null, executionId?: string | null): Promise<void>;

  getConversationContext(conversationId: string): Promise<{ conversation: ConversationSnapshot; contact: ContactSnapshot } | null>;
  getActiveExecution(conversationId: string): Promise<ExecutionRecord | null>;
  getExecution(id: string): Promise<ExecutionRecord | null>;
  getFlowVersion(versionId: string): Promise<FlowVersionRecord | null>;
  getFlowStatus(flowId: string): Promise<FlowStatus | null>;
  listTriggerCandidates(includeTesting: boolean): Promise<TriggerCandidateRecord[]>;
  countPriorExecutions(contactId: string): Promise<number>;
  setExecutionStatus(id: string, status: ExecutionStatus, error?: string | null): Promise<void>;
  /** Cancels scheduled jobs of an execution and returns their QStash message ids. */
  cancelJobsForExecution(executionId: string): Promise<string[]>;

  getScheduledJob(id: string): Promise<ScheduledJobRecord | null>;
  claimScheduledJob(id: string): Promise<ScheduledJobRecord | null>;
  getCrmDelivery(id: string): Promise<CrmDeliveryRecord | null>;

  recordSecurityEvent(input: {
    scope: string;
    identifier: string;
    contactId?: string | null;
    action?: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
  countRecentSecurityEvents(scope: string, contactId: string, sinceIso: string): Promise<number>;

  /** Waits for writes the store runs in the background. Call before the request ends. */
  flush(): Promise<void>;
}

export interface Limiter {
  limit(identifier: string, rule: { prefix: string; tokens: number; windowSeconds: number }): Promise<{ success: boolean; remaining: number; reset: number }>;
}
