"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, runAction } from "@/lib/auth/guard";

export async function markNotificationsRead(ids?: string[]) {
  return runAction(async () => {
    await requireAdmin({ role: "staff" });
    const supabase = await createClient();
    let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (ids?.length) q = q.in("id", ids);
    const { error } = await q;
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
  });
}
