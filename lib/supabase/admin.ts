import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS — use ONLY in trusted server code paths
 * (webhooks, QStash workers, auth administration) after authenticating the
 * caller by other means (signature verification or requireAdmin()).
 */
export function createAdminClient(): SupabaseClient {
  if (admin) return admin;
  admin = createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "sgh-server" } },
  });
  return admin;
}
