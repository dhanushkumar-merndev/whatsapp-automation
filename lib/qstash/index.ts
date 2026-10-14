import "server-only";
import { Client, Receiver } from "@upstash/qstash";
import { appUrl, serverEnv } from "@/lib/env";
import type { Scheduler } from "@/lib/engine/types";

let client: Client | null = null;

export function qstashClient(): Client {
  if (client) return client;
  const env = serverEnv();
  client = new Client({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL });
  return client;
}

export function jobsEndpoint() {
  return `${appUrl()}/api/jobs/qstash`;
}

/**
 * Schedules delayed work through QStash. The job id doubles as the QStash
 * deduplication id, so re-publishing the same job never creates a second
 * delivery. No server process stays open while waiting.
 */
export class QStashScheduler implements Scheduler {
  constructor(private readonly retries: number) {}

  async schedule(input: { jobId: string; delaySeconds: number }) {
    const res = await qstashClient().publishJSON({
      url: jobsEndpoint(),
      body: { jobId: input.jobId },
      delay: Math.max(0, Math.round(input.delaySeconds)),
      deduplicationId: input.jobId,
      retries: this.retries,
    });
    const messageId = (res as { messageId?: string }).messageId ?? null;
    return { messageId };
  }

  async cancel(messageId: string) {
    await qstashClient().messages.cancel(messageId);
  }
}

/** Verifies the Upstash-Signature header against the raw request body. */
export async function verifyQStashSignature(input: { signature: string | null; body: string; url: string }): Promise<boolean> {
  if (!input.signature) return false;
  const env = serverEnv();
  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });
  try {
    return await receiver.verify({ signature: input.signature, body: input.body, url: input.url });
  } catch {
    return false;
  }
}
