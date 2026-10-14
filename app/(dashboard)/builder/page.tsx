import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

/** "Flow Builder" in the sidebar opens the most recently edited flow. */
export default async function BuilderPage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("flows")
    .select("id")
    .neq("status", "archived")
    .order("draft_updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  redirect(data ? `/flows/${data.id}` : "/flows?new=1");
}
