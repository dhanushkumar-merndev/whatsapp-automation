"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { retryLeadCrmSync } from "@/lib/server/crm-retry";

const LEAD_STATUSES = ["incomplete", "new", "qualified", "contacted", "won", "lost", "closed"] as const;

export async function updateLeadAction(input: { leadId: string; status?: string; assignedTo?: string | null; notes?: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "staff", limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const parsed = z
      .object({
        leadId: z.uuid(),
        status: z.enum(LEAD_STATUSES).optional(),
        assignedTo: z.uuid().nullable().optional(),
        notes: z.string().max(5000).optional(),
      })
      .parse(input);
    const patch: Record<string, unknown> = {};
    if (parsed.status) patch.status = parsed.status;
    if (parsed.assignedTo !== undefined) patch.assigned_to = parsed.assignedTo;
    if (parsed.notes !== undefined) patch.notes = parsed.notes;
    const supabase = await createClient();
    const { error } = await supabase.from("leads").update(patch).eq("id", parsed.leadId);
    if (error) throw new Error(error.message);
    await audit(session, "lead.updated", { type: "lead", id: parsed.leadId }, { fields: Object.keys(patch) });
    revalidatePath(`/leads/${parsed.leadId}`);
    revalidatePath("/leads");
  });
}

export async function retryCrmAction(input: { leadId: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "crm_retry", tokens: 30, windowSeconds: 600 } });
    const leadId = z.uuid().parse(input.leadId);
    const results = await retryLeadCrmSync(leadId);
    await audit(session, "lead.crm_retry", { type: "lead", id: leadId }, { results });
    revalidatePath(`/leads/${leadId}`);
    return results;
  });
}

export async function deleteLeadAction(input: { leadId: string }) {
  return runAction(async () => {
    const session = await requireAdmin();
    const leadId = z.uuid().parse(input.leadId);
    const supabase = await createClient();
    const { error } = await supabase.from("leads").delete().eq("id", leadId);
    if (error) throw new Error(error.message);
    await audit(session, "lead.deleted", { type: "lead", id: leadId });
    revalidatePath("/leads");
  });
}
