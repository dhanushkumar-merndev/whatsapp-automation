import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const LEAD_VIEWS = {
  all: "All leads",
  new: "New",
  qualified: "Qualified",
  incomplete: "Incomplete enquiries",
  crm_pending: "CRM sync pending",
  crm_synced: "CRM sync completed",
  crm_failed: "CRM sync failed",
} as const;
export type LeadView = keyof typeof LEAD_VIEWS;

export interface LeadFilters {
  view: LeadView;
  q: string;
  service: string;
  from: string;
  to: string;
  assigned: string;
  /** Customer tag (from "Tag customer" steps). */
  tag: string;
  includeTest: boolean;
}

export function parseLeadFilters(sp: Record<string, string | string[] | undefined>): LeadFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const view = (s("view") in LEAD_VIEWS ? s("view") : "all") as LeadView;
  return {
    view,
    q: s("q").slice(0, 100),
    service: s("service").slice(0, 100),
    from: /^\d{4}-\d{2}-\d{2}$/.test(s("from")) ? s("from") : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(s("to")) ? s("to") : "",
    assigned: s("assigned"),
    tag: s("tag").slice(0, 40),
    includeTest: s("test") === "1",
  };
}

export interface LeadRow {
  id: string;
  name: string | null;
  phone: string;
  business_name: string | null;
  service: string | null;
  service_id: string | null;
  requirements: string | null;
  email: string | null;
  status: string;
  crm_sync_status: string;
  crm_last_synced_at: string | null;
  assigned_to: string | null;
  notes: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  flow_id: string | null;
  conversation_id: string;
  source: string;
}

export const LEAD_COLUMNS =
  "id, name, phone, business_name, service, service_id, requirements, email, status, crm_sync_status, crm_last_synced_at, assigned_to, notes, is_test, created_at, updated_at, last_activity_at, flow_id, conversation_id, source";

/** Contacts carrying a tag (leads are filtered by these). */
export async function contactsWithTag(db: SupabaseClient, tag: string): Promise<string[]> {
  const { data } = await db.from("contacts").select("id").contains("tags", [tag]).limit(1000);
  return (data ?? []).map((r) => r.id as string);
}

/** `tagged`: contact ids for `f.tag` (see contactsWithTag). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLeadFilters(q: any, f: LeadFilters, tagged?: string[]) {
  if (!f.includeTest) q = q.eq("is_test", false);
  switch (f.view) {
    case "new":
      q = q.eq("status", "new");
      break;
    case "qualified":
      q = q.eq("status", "qualified");
      break;
    case "incomplete":
      q = q.eq("status", "incomplete");
      break;
    case "crm_pending":
      q = q.eq("crm_sync_status", "pending").neq("status", "incomplete");
      break;
    case "crm_synced":
      q = q.eq("crm_sync_status", "synced");
      break;
    case "crm_failed":
      q = q.eq("crm_sync_status", "failed");
      break;
  }
  if (f.q) {
    const term = f.q.replace(/[%,()]/g, " ").trim();
    if (term) q = q.or(`name.ilike.%${term}%,phone.ilike.%${term.replace(/\D/g, "") || term}%,business_name.ilike.%${term}%,requirements.ilike.%${term}%`);
  }
  if (f.service) q = q.eq("service", f.service);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00Z`);
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59Z`);
  if (f.assigned === "me" || /^[0-9a-f-]{36}$/.test(f.assigned)) q = q.eq("assigned_to", f.assigned);
  if (f.assigned === "unassigned") q = q.is("assigned_to", null);
  if (f.tag && tagged) q = q.in("contact_id", tagged.length ? tagged : ["00000000-0000-0000-0000-000000000000"]);
  return q;
}

export async function fetchLeads(db: SupabaseClient, f: LeadFilters, range: { from: number; to: number }) {
  const tagged = f.tag ? await contactsWithTag(db, f.tag) : undefined;
  const res = await applyLeadFilters(db.from("leads").select(LEAD_COLUMNS, { count: "exact" }), f, tagged)
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  return { data: (res.data ?? null) as LeadRow[] | null, count: (res.count ?? 0) as number, error: res.error as { message: string } | null };
}
