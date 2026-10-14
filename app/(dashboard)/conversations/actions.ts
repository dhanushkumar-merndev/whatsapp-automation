"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { isWindowOpen } from "@/lib/engine/window";
import { loadSettings } from "@/lib/settings/server";
import { SupabaseStore } from "@/lib/server/supabase-store";
import { MetaSender } from "@/lib/whatsapp/graph";
import { qstashClient } from "@/lib/qstash";

/** A staff member replies manually — only inside the customer service window. */
export async function sendManualReplyAction(input: { conversationId: string; text: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "staff", limit: { prefix: "manual_reply", tokens: 30, windowSeconds: 60 } });
    const { conversationId, text } = z.object({ conversationId: z.uuid(), text: z.string().trim().min(1).max(4096) }).parse(input);
    const store = new SupabaseStore();
    const ctx = await store.getConversationContext(conversationId);
    if (!ctx) throw new Error("Conversation not found");
    const settings = await loadSettings();
    if (!isWindowOpen(ctx.conversation.lastInboundAt, new Date(), settings)) {
      throw new Error("The 24-hour customer service window has closed. You can reply again after the customer sends a new message.");
    }
    if (ctx.contact.optedOut) throw new Error("This customer has opted out (STOP).");
    const key = `manual:${crypto.randomUUID()}`;
    await store.claimOutbound({
      idempotencyKey: key,
      conversationId,
      contactId: ctx.contact.id,
      executionId: null,
      nodeId: null,
      message: { kind: "text", text },
      preview: text,
      mediaAssetId: null,
      isTest: ctx.conversation.isTest,
      sentBy: session.userId,
    });
    try {
      const { waMessageId } = await new MetaSender().send({
        to: ctx.contact.waId,
        phoneNumberId: ctx.conversation.phoneNumberId,
        message: { kind: "text", text },
      });
      await store.completeOutbound(key, { waMessageId });
      await store.incrementUsage({ service: "whatsapp", metric: "messages_sent", isTest: ctx.conversation.isTest });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await store.completeOutbound(key, { error: msg });
      throw new Error(msg);
    }
    await audit(session, "conversation.manual_reply", { type: "conversation", id: conversationId });
    revalidatePath(`/conversations/${conversationId}`);
  });
}

/** Handoff (stop automation), resume automation, or close a conversation. */
export async function setConversationStatusAction(input: { conversationId: string; status: "handoff" | "open" | "closed" }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "staff" });
    const { conversationId, status } = z
      .object({ conversationId: z.uuid(), status: z.enum(["handoff", "open", "closed"]) })
      .parse(input);
    const supabase = await createClient();
    const patch: Record<string, unknown> = { status };
    if (status === "handoff") {
      patch.handoff_reason = "Taken over by a team member";
      patch.handoff_at = new Date().toISOString();
      patch.assigned_to = session.userId;
    }
    const { error } = await supabase.from("conversations").update(patch).eq("id", conversationId);
    if (error) throw new Error(error.message);
    if (status !== "open") {
      // Stop any running automation for this conversation.
      const store = new SupabaseStore();
      const active = await store.getActiveExecution(conversationId);
      if (active) {
        await store.setExecutionStatus(active.id, status === "handoff" ? "handoff" : "cancelled", "Stopped by a team member");
        for (const id of await store.cancelJobsForExecution(active.id)) {
          await qstashClient().messages.cancel(id).catch(() => undefined);
        }
      }
    }
    await audit(session, `conversation.${status}`, { type: "conversation", id: conversationId });
    revalidatePath(`/conversations/${conversationId}`);
    revalidatePath("/conversations");
  });
}
