import type { NextRequest } from "next/server";
import { z } from "zod";
import { AuthzError, requireAdmin } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short-lived signed URL for previewing a private file (MFA-verified staff only). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/media/[id]/preview">) {
  try {
    await requireAdmin({ role: "staff" });
  } catch (e) {
    return Response.json({ error: "Unauthorized" }, { status: e instanceof AuthzError ? e.status : 401 });
  }
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: asset } = await admin.from("media_assets").select("storage_path, status, deleted_at").eq("id", id).maybeSingle();
  if (!asset || asset.deleted_at || asset.status !== "ready") return new Response("Not found", { status: 404 });
  const { data, error } = await admin.storage.from("media").createSignedUrl(asset.storage_path, 60);
  if (error || !data) return new Response("Unavailable", { status: 500 });
  return Response.redirect(data.signedUrl, 302);
}
