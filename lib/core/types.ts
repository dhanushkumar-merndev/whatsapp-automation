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
  /** Either the account id, or the phone number id + WABA id it is resolved from (enabled accounts only). */
  accountId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  waId: string;
  profileName: string | null;
  waMessageId: string;
  type: string;
  body: string | null;
  payload: Record<string, unknown>;
  providerTimestamp: string;
  /** Test numbers from settings are also detected by the store. */
  isTest: boolean;
}

export type InboundRecordResult =
  | { ignored: "unknown_account" }
  | {
      ignored?: undefined;
      accountId: string;
      contactId: string;
      conversationId: string;
      conversationStatus: ConversationSnapshot["status"];
      optedOut: boolean;
      cooldownUntil: string | null;
      isTest: boolean;
      messageId: string | null;
      duplicate: boolean;
      newContact: boolean;
    };

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

/** A published flow that may start for this conversation (definition loaded separately, cached). */
export interface TriggerCandidateRef {
  flowId: string;
  flowName: string;
  status: FlowStatus;
  priority: number;
  versionId: string;
  version: number;
}

export interface TriggerCandidateRecord extends TriggerCandidateRef {
  definition: FlowDefinition;
}

/** Everything handling one inbound message reads before acting (one round trip). */
export interface TurnState {
  conversation: ConversationSnapshot;
  contact: ContactSnapshot;
  active: ExecutionRecord | null;
  activeFlowStatus: FlowStatus | null;
  /** When the last execution of this conversation ended; messages sent before it arrived mid-run. */
  lastCompletedAt: string | null;
  candidates: TriggerCandidateRef[];
  priorExecutions: number;
}

export type BeginTurnResult = { locked: false } | { locked: true; pending: PendingInbound[]; state: TurnState | null };

export type InboundProcessingStatus = "processed" | "rate_limited" | "ignored" | "failed";

/** Everything the webhook/worker pipeline needs from persistence. */
export interface AppStore extends EngineStore {
  recordInbound(input: InboundRecordInput): Promise<InboundRecordResult>;
  applyStatus(input: StatusUpdateInput): Promise<boolean>;

  acquireLock(conversationId: string, token: string, ttlSeconds: number): Promise<boolean>;
  /** Takes the lease lock and returns the pending messages plus the turn state. */
  beginTurn(conversationId: string, token: string, ttlSeconds: number, limit: number): Promise<BeginTurnResult>;
  getTurnState(conversationId: string): Promise<TurnState | null>;
  releaseLock(conversationId: string, token: string): Promise<void>;
  listPendingInbound(conversationId: string, limit: number): Promise<PendingInbound[]>;
  markInbound(messageId: string, status: InboundProcessingStatus, note?: string | null, executionId?: string | null): Promise<void>;

  getConversationContext(conversationId: string): Promise<{ conversation: ConversationSnapshot; contact: ContactSnapshot } | null>;
  getActiveExecution(conversationId: string): Promise<ExecutionRecord | null>;
  getExecution(id: string): Promise<ExecutionRecord | null>;
  getFlowVersion(versionId: string): Promise<FlowVersionRecord | null>;
  getFlowStatus(flowId: string): Promise<FlowStatus | null>;
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

  /** Runs a side task (e.g. a typing indicator) without blocking; flush() waits for it. */
  background(what: string, task: () => Promise<unknown>): void;
  /** Waits for writes the store runs in the background. Call before the request ends. */
  flush(): Promise<void>;
}

export interface Limiter {
  limit(identifier: string, rule: { prefix: string; tokens: number; windowSeconds: number }): Promise<{ success: boolean; remaining: number; reset: number }>;
}
