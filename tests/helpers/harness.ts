import { MemoryStore } from "@/lib/core/memory-store";
import { FakeCrm, RecordingScheduler, RecordingSender } from "@/lib/core/fakes";
import type { PipelineDeps } from "@/lib/core/process-conversation";
import { processIngested } from "@/lib/core/conversation-control";
import { ingestWebhook } from "@/lib/core/webhook-ingest";
import { handleScheduledJob } from "@/lib/core/jobs";
import { MemoryLimiter } from "@/lib/ratelimit";
import { parseSettings, type AppSettings } from "@/lib/settings/schema";
import { silentLogger } from "@/lib/engine/types";
import { buildDefaultFlowDefinition } from "../fixtures/star-flow";
import type { FlowDefinition } from "@/lib/engine/schema";
import { metaInboundPayload, type InboundSpec } from "./meta";

export function createHarness(
  opts: { settings?: Partial<AppSettings>; definition?: FlowDefinition; withBrochure?: boolean; inlineWaits?: boolean } = {},
) {
  let now = new Date("2026-10-14T10:00:00Z");
  const clock = {
    now: () => now,
    advance(seconds: number) {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
  const store = new MemoryStore(clock.now);
  store.addAccount({ phoneNumberId: "PN1", wabaId: "WABA1" });
  const brochure = opts.withBrochure === false ? null : store.addMedia({ name: "Brochure.pdf" });
  const definition = opts.definition ?? buildDefaultFlowDefinition(brochure?.id ?? null);
  const flow = store.addFlow({ name: "Star Growth Hub — Enquiry", status: "active", definition });
  const sender = new RecordingSender();
  const scheduler = new RecordingScheduler();
  const crm = new FakeCrm();
  const settings = parseSettings(opts.settings ?? {});
  store.testPhoneNumbers = settings.testPhoneNumbers;
  store.onAppReply = settings.coexistence.onAppReply;
  const deps: PipelineDeps = {
    store,
    sender,
    scheduler,
    crm,
    settings,
    now: clock.now,
    logger: silentLogger,
    mode: "live",
    limiter: new MemoryLimiter(() => clock.now().getTime()),
    // Short waits "sleep" by moving the fake clock, like production does in real time.
    ...(opts.inlineWaits ? { inlineWait: { sleep: async (ms: number) => clock.advance(ms / 1000), budgetMs: 25_000 } } : {}),
  };
  const ran = new Set<string>();

  async function deliver(payload: unknown) {
    const result = await ingestWebhook({ store, now: clock.now }, payload);
    // Each delivery is its own request with its own in-request wait budget.
    if (deps.inlineWait) deps.inlineWait.budgetMs = 25_000;
    await processIngested(deps, result, (_id, e) => {
      throw e;
    });
    return result;
  }

  return {
    store,
    sender,
    scheduler,
    crm,
    settings,
    deps,
    clock,
    flow,
    brochure,
    deliver,
    async say(text: string, spec: Omit<InboundSpec, "text"> = {}) {
      return deliver(metaInboundPayload([{ text, timestamp: clock.now(), ...spec }]));
    },
    /** Taps a button or list row; `contextId` is the wamid of the message it sits under. */
    async select(replyId: string, replyTitle?: string, contextId?: string) {
      return deliver(metaInboundPayload([{ replyId, replyTitle, contextId, timestamp: clock.now() }]));
    },
    /** Simulates QStash delivering every scheduled job that is now due. */
    async runDueJobs(opts: { retried?: number } = {}) {
      const results = [];
      for (const s of scheduler.scheduled) {
        if (ran.has(s.jobId)) continue;
        const job = store.jobs.get(s.jobId);
        if (job && new Date(job.runAt).getTime() > clock.now().getTime()) continue;
        ran.add(s.jobId);
        results.push(await handleScheduledJob(deps, s.jobId, { retried: opts.retried ?? 0, lockWaitMs: 0 }));
      }
      return results;
    },
    execution() {
      return [...store.executions.values()].at(-1)!;
    },
    lead() {
      return [...store.leads.values()].at(-1);
    },
  };
}
