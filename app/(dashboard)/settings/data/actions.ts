"use server";

import { z } from "zod";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { RESTORABLE_TABLES } from "@/lib/data-backup";

const chunkSchema = z.object({
  table: z.enum(RESTORABLE_TABLES as unknown as [string, ...string[]]),
  rows: z.array(z.record(z.string(), z.unknown())).max(2000),
});

interface RestoreResult {
  inserted: number;
  skipped: number;
  retry: Record<string, unknown>[];
  errors: string[];
}

/** Adds the rows of one table that are missing. Never deletes or overwrites. Owners only. */
export async function restoreRowsAction(input: z.input<typeof chunkSchema>) {
  return runAction<RestoreResult>(async () => {
    await requireAdmin({ role: "owner", limit: { prefix: "data_restore", tokens: 600, windowSeconds: 600 } });
    const { table, rows } = chunkSchema.parse(input);
    const { data, error } = await createAdminClient().rpc("restore_rows", { p_table: table, p_rows: rows });
    if (error) throw new Error(error.message);
    return data as RestoreResult;
  });
}

/** Records the finished restore in the audit log. */
export async function finishRestoreAction(summary: { fileDate: string | null; totals: Record<string, { inserted: number; skipped: number; failed: number }> }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "owner" });
    await audit(session, "data.restored", { type: "database" }, summary);
  });
}
