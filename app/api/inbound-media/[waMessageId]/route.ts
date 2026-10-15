import type { NextRequest } from "next/server";
import { AuthzError, requireAdmin } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInboundMedia } from "@/lib/whatsapp/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shows a photo or file a customer sent (MFA-verified staff only), fetched from Meta on demand. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/inbound-media/[waMessageId]">) {
  try {
    await requireAdmin({ role: "staff" });
  } catch (e) {
    return Response.json({ error: "Unauthorized" }, { status: e instanceof AuthzError ? e.status : 401 });
  }
  const { waMessageId } = await ctx.params;
  if (!/^[\w.=:+/-]{5,200}$/.test(waMessageId)) return new Response("Not found", { status: 404 });
  const { data: msg } = await createAdminClient()
    .from("messages")
    .select("payload, conversations(whatsapp_accounts(phone_number_id))")
    .eq("wa_message_id", waMessageId)
    .eq("direction", "inbound")
    .maybeSingle();
  const mediaId = (msg?.payload as { media_id?: unknown } | null)?.media_id;
  if (typeof mediaId !== "string" || !mediaId) return new Response("Not found", { status: 404 });
  try {
    const conv = (Array.isArray(msg?.conversations) ? msg.conversations[0] : msg?.conversations) as { whatsapp_accounts?: { phone_number_id?: string } | { phone_number_id?: string }[] } | null;
    const acc = Array.isArray(conv?.whatsapp_accounts) ? conv.whatsapp_accounts[0] : conv?.whatsapp_accounts;
    const file = await fetchInboundMedia(mediaId, acc?.phone_number_id);
    // Customer files are untrusted: only images, video, audio and PDFs open inline, always sandboxed.
    const inline = /^(image|video|audio)\/|^application\/pdf$/.test(file.contentType);
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": inline ? "inline" : "attachment",
        // Browsers won't render PDFs in a sandbox; everything else gets one.
        ...(file.contentType === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'" }),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return new Response(`File no longer available from WhatsApp (${e instanceof Error ? e.message : "error"}).`, { status: 410 });
  }
}
