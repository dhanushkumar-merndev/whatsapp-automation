"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { appSettingsSchema, type AppSettings } from "@/lib/settings/schema";
import { invalidateSettingsCache, loadSettings } from "@/lib/settings/server";

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k];
    out[k] = cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/** Updates part of the application settings (validated against the full schema). */
export async function updateSettingsAction(patch: Record<string, unknown>) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const current = await loadSettings();
    const next: AppSettings = appSettingsSchema.parse(deepMerge(current, patch));
    if (next.usage.qstashDailyBudget < 0) throw new Error("Budget must be positive");
    const supabase = await createClient();
    const { error } = await supabase.from("app_settings").update({ settings: next, updated_by: session.userId, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new Error(error.message);
    invalidateSettingsCache();
    await audit(session, "settings.updated", { type: "app_settings", id: "1" }, { sections: Object.keys(patch) });
    revalidatePath("/", "layout");
  });
}

const planLimitSchema = z.object({
  id: z.uuid().nullable(),
  service: z.enum(["qstash", "redis", "supabase", "meta_whatsapp", "vercel"]),
  metric: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/),
  period: z.enum(["day", "month", "total", "per_message"]),
  limit_value: z.number().min(0).nullable(),
  unit: z.string().max(30).nullable(),
  unit_price: z.number().min(0).nullable(),
  currency: z.string().max(3).nullable(),
  category: z.string().max(40).nullable(),
  country_code: z.string().max(4).nullable(),
  phone_number_id: z.string().max(40).nullable(),
  plan_name: z.string().max(40).nullable(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().max(500).nullable(),
  active: z.boolean(),
});

export async function savePlanLimitAction(input: z.input<typeof planLimitSchema>) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const { id, ...row } = planLimitSchema.parse(input);
    const supabase = await createClient();
    const res = id
      ? await supabase.from("plan_limits").update({ ...row, source: "manual" }).eq("id", id)
      : await supabase.from("plan_limits").insert({ ...row, source: "manual" });
    if (res.error) throw new Error(res.error.message);
    await audit(session, id ? "plan_limit.updated" : "plan_limit.created", { type: "plan_limit", id }, row);
    revalidatePath("/usage");
  });
}

export async function deletePlanLimitAction(input: { id: string }) {
  return runAction(async () => {
    const session = await requireAdmin();
    const id = z.uuid().parse(input.id);
    const supabase = await createClient();
    const { error } = await supabase.from("plan_limits").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await audit(session, "plan_limit.deleted", { type: "plan_limit", id });
    revalidatePath("/usage");
  });
}
