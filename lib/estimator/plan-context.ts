import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/settings/schema";
import type { PlanContext } from "./estimate";
import { buildPlanContext, type PlanLimitRow } from "./plan-rows";

export { defaultAssumptions, pickMetaRate, type PlanLimitRow } from "./plan-rows";

/**
 * Loads configured allowances, measured storage and other flows' projected
 * usage. `excludeFlowId` is the flow being estimated (its own previous
 * snapshot must not be counted as "other" usage).
 */
export async function loadPlanContext(settings: AppSettings, excludeFlowId?: string | null): Promise<PlanContext> {
  const admin = createAdminClient();
  const [{ data: limits }, { data: flows }, storage] = await Promise.all([
    admin.from("plan_limits").select("*"),
    admin.from("flows").select("id, status, estimate_snapshot").in("status", ["active", "testing"]),
    admin.rpc("get_storage_usage").then((r) => (r.error ? null : (r.data as { database_bytes: number; media_bytes: number }))),
  ]);
  return buildPlanContext({
    settings,
    limits: (limits ?? []) as PlanLimitRow[],
    flows: flows ?? [],
    storage,
    excludeFlowId,
  });
}
