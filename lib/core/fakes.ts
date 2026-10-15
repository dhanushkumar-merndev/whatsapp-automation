import {
  SendError,
  type CrmDeliveryRecord,
  type CrmDeliveryResult,
  type CrmDispatcher,
  type CrmIntegrationRecord,
  type MessageSender,
  type OutboundMessage,
  type Scheduler,
} from "@/lib/engine/types";

/** Captures messages instead of calling Meta (simulation mode and tests). */
export class RecordingSender implements MessageSender {
  sent: { to: string; message: OutboundMessage; waMessageId: string }[] = [];
  failNext: SendError | Error | null = null;
  private n = 0;

  async send(input: { to: string; message: OutboundMessage }) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const waMessageId = `wamid.sim.${++this.n}`;
    this.sent.push({ to: input.to, message: input.message, waMessageId });
    return { waMessageId };
  }

  /** Messages marked read with "typing…" (live mode only). */
  reads: string[] = [];

  async markRead(input: { waMessageId: string }) {
    this.reads.push(input.waMessageId);
  }

  texts(): string[] {
    return this.sent.map(({ message: m }) =>
      m.kind === "text"
        ? m.text
        : m.kind === "media"
          ? `[${m.mediaType}]`
          : m.kind === "template"
            ? `[template ${m.name}]`
            : m.kind === "location"
              ? `[location] ${m.name ?? `${m.latitude},${m.longitude}`}`
              : m.body,
    );
  }
}

/** Captures delayed jobs instead of publishing to QStash. */
export class RecordingScheduler implements Scheduler {
  scheduled: { jobId: string; delaySeconds: number; messageId: string }[] = [];
  cancelled: string[] = [];
  private n = 0;

  async schedule(input: { jobId: string; delaySeconds: number }) {
    const messageId = `msg_sim_${++this.n}`;
    this.scheduled.push({ ...input, messageId });
    return { messageId };
  }

  async cancel(messageId: string) {
    this.cancelled.push(messageId);
  }
}

/** Scriptable CRM endpoint. */
export class FakeCrm implements CrmDispatcher {
  calls: { integration: CrmIntegrationRecord; delivery: CrmDeliveryRecord }[] = [];
  responses: CrmDeliveryResult[] = [];

  async deliver(integration: CrmIntegrationRecord, delivery: CrmDeliveryRecord): Promise<CrmDeliveryResult> {
    this.calls.push({ integration, delivery: structuredClone(delivery) });
    return (
      this.responses.shift() ?? { ok: true, statusCode: 200, error: null, responseExcerpt: "ok", durationMs: 5, retryable: false }
    );
  }
}
