"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { isWindowOpen } from "@/lib/engine/window";
import { loadSettings } from "@/lib/settings/server";
import { SupabaseStore } from "@/lib/server/supabase-store";
import { MetaSender } from "@/lib/whatsapp/graph";
import { createPipelineDeps } from "@/lib/server/pipeline";
import { applyChatAction, type ChatAction } from "@/lib/core/conversation-control";

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
      // A person replied: counts for "hand back to the bot after N hours".
      await (await createClient()).from("conversations").update({ human_last_reply_at: new Date().toISOString() }).eq("id", conversationId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await store.completeOutbound(key, { error: msg });
      throw new Error(msg);
    }
    await audit(session, "conversation.manual_reply", { type: "conversation", id: conversationId });
    revalidatePath(`/conversations/${conversationId}`);
  });
}

/**
 * Who handles the chat: "human" (bot paused), "bot_on", "restart" (bot on and
 * the live workflow starts now) or "close". Same rules as the Telegram buttons.
 */
export async function setConversationStatusAction(input: { conversationId: string; action: ChatAction }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "staff" });
    const { conversationId, action } = z
      .object({ conversationId: z.uuid(), action: z.enum(["human", "bot_on", "restart", "close"]) })
      .parse(input);
    const deps = await createPipelineDeps("dashboard.conversation");
    const result = await applyChatAction(deps, conversationId, action, "team");
    if (action === "human") await (await createClient()).from("conversations").update({ assigned_to: session.userId }).eq("id", conversationId);
    await deps.store.flush();
    await audit(session, `conversation.${action}`, { type: "conversation", id: conversationId }, { message: result.message });
    revalidatePath(`/conversations/${conversationId}`);
    revalidatePath("/conversations");
    if (!result.ok) throw new Error(result.message);
    return result.message;
  });
}
