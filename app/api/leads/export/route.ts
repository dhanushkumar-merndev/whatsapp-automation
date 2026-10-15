import type { NextRequest } from "next/server";
import { AuthzError, audit, requireAdmin } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { applyLeadFilters, contactsWithTag, LEAD_COLUMNS, parseLeadFilters } from "@/lib/server/lead-query";
import { csvCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = [
  ["id", "Lead ID"],
  ["name", "Name"],
  ["phone", "WhatsApp number"],
  ["business_name", "Business"],
  ["service", "Service"],
  ["requirements", "Requirements"],
  ["email", "Email"],
  ["status", "Status"],
  ["crm_sync_status", "CRM sync"],
  ["source", "Source"],
  ["created_at", "Created"],
  ["updated_at", "Updated"],
] as const;

/** CSV export — authorised administrators (MFA-verified) only. */
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireAdmin({ limit: { prefix: "lead_export", tokens: 10, windowSeconds: 600 } });
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 401;
    return Response.json({ error: e instanceof Error ? e.message : "Unauthorized" }, { status });
  }
  const filters = parseLeadFilters(Object.fromEntries(req.nextUrl.searchParams));
  if (filters.assigned === "me") filters.assigned = session.userId;
  const supabase = await createClient();
  const tagged = filters.tag ? await contactsWithTag(supabase, filters.tag) : undefined;
  const { data, error } = await applyLeadFilters(supabase.from("leads").select(LEAD_COLUMNS), filters, tagged)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const lines = [COLUMNS.map(([, h]) => csvCell(h)).join(",")];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    lines.push(COLUMNS.map(([k]) => csvCell(k === "phone" ? `+${row.phone}` : row[k])).join(","));
  }
  await audit(session, "leads.exported", { type: "lead" }, { rows: data?.length ?? 0, filters });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
