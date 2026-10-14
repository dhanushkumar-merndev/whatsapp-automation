import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSettings, type AppSettings } from "./schema";

let memo: { at: number; value: AppSettings } | null = null;
const TTL_MS = 30_000;

async function fetchSettings(): Promise<AppSettings> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  const { data, error } = await createAdminClient().from("app_settings").select("settings").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  const value = parseSettings(data?.settings ?? {});
  memo = { at: Date.now(), value };
  return value;
}

/** Application settings with defaults applied. Cached per request and for 30 s per instance. */
export const loadSettings = cache(fetchSettings);

export function invalidateSettingsCache() {
  memo = null;
}
