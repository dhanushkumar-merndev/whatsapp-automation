import "server-only";
import { isProduction } from "@/lib/env";
import { loadSettings } from "@/lib/settings/server";
import { getRateLimiter } from "@/lib/ratelimit";
import { QStashScheduler } from "@/lib/qstash";
import { MetaSender } from "@/lib/whatsapp/graph";
import { HttpCrmDispatcher } from "@/lib/crm/dispatch";
import type { PipelineDeps } from "@/lib/core/process-conversation";
import { SupabaseStore, type SupabaseStoreOptions } from "./supabase-store";
import { createLogger } from "./logger";

export function crmUrlPolicy() {
  return { requireHttps: isProduction(), allowLoopback: !isProduction() };
}

/**
 * Production dependencies for the webhook, QStash worker and cron sweep.
 * With `backgroundWrites`, the caller must `await deps.store.flush()` before the request ends.
 */
export async function createPipelineDeps(scope: string, storeOptions: SupabaseStoreOptions = {}): Promise<PipelineDeps> {
  const settings = await loadSettings();
  return {
    store: new SupabaseStore(undefined, storeOptions),
    sender: new MetaSender(),
    scheduler: new QStashScheduler(settings.usage.qstashRetries),
    crm: new HttpCrmDispatcher(crmUrlPolicy()),
    limiter: getRateLimiter(),
    settings,
    now: () => new Date(),
    logger: createLogger(scope),
    mode: "live",
  };
}
