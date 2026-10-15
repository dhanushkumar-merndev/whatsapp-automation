import "server-only";
import { isProduction } from "@/lib/env";
import { loadSettings } from "@/lib/settings/server";
import { getRateLimiter } from "@/lib/ratelimit";
import { QStashScheduler } from "@/lib/qstash";
import { accessTokenFor, MetaSender } from "@/lib/whatsapp/graph";
import { createAdminClient } from "@/lib/supabase/admin";
import { HttpCrmDispatcher } from "@/lib/crm/dispatch";
import type { PipelineDeps } from "@/lib/core/process-conversation";
import type { AppStore } from "@/lib/core/types";
import type { MessageSender } from "@/lib/engine/types";
import { SupabaseStore, type SupabaseStoreOptions } from "./supabase-store";
import { createLogger } from "./logger";
import { createHttpPort } from "./http-port";

export function crmUrlPolicy() {
  return { requireHttps: isProduction(), allowLoopback: !isProduction() };
}

/** Total in-request waiting per request; the functions run for at most 60 s. */
const INLINE_WAIT_BUDGET_MS = 25_000;

export function createStore(storeOptions: SupabaseStoreOptions = {}): AppStore {
  return new SupabaseStore(undefined, storeOptions);
}

export function createSender(): MessageSender {
  return new MetaSender();
}

const WARM_EVERY_MS = 20_000;
let warmedAt = 0;

/**
 * Keep-warm ping (pg_cron, every minute): loads the settings, the live
 * workflows and the account tokens into this instance's caches, so the next
 * customer message doesn't start from a cold, empty instance. Read-only.
 */
export async function warmUp(): Promise<void> {
  if (Date.now() - warmedAt < WARM_EVERY_MS) return;
  warmedAt = Date.now();
  const admin = createAdminClient();
  const store = createStore();
  const [, flows, accounts] = await Promise.all([
    loadSettings(),
    admin.from("flows").select("published_version_id").in("status", ["active", "testing"]).not("published_version_id", "is", null),
    admin.from("whatsapp_accounts").select("phone_number_id").eq("enabled", true),
  ]);
  await Promise.all([
    ...(flows.data ?? []).map((f) => store.getFlowVersion(f.published_version_id as string)),
    ...(accounts.data ?? []).map((a) => accessTokenFor({ phoneNumberId: a.phone_number_id as string })),
  ]);
}

/**
 * Production dependencies for the webhook, QStash worker and cron sweep.
 * With `backgroundWrites`, the caller must `await deps.store.flush()` before the request ends.
 * Pass `parts` to reuse a store or sender created earlier in the request.
 */
export async function createPipelineDeps(
  scope: string,
  storeOptions: SupabaseStoreOptions = {},
  parts: { store?: AppStore; sender?: MessageSender } = {},
): Promise<PipelineDeps> {
  const settings = await loadSettings();
  return {
    store: parts.store ?? createStore(storeOptions),
    sender: parts.sender ?? createSender(),
    scheduler: new QStashScheduler(settings.execution.qstashRetries),
    crm: new HttpCrmDispatcher(crmUrlPolicy()),
    limiter: getRateLimiter(),
    settings,
    now: () => new Date(),
    logger: createLogger(scope),
    mode: "live",
    inlineWait: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), budgetMs: INLINE_WAIT_BUDGET_MS },
    http: createHttpPort(crmUrlPolicy()),
  };
}
