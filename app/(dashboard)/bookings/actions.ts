"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { isWindowOpen } from "@/lib/engine/window";
import { formatDay } from "@/lib/engine/input-types";
import { timeLabel } from "@/lib/engine/booking";
import { loadSettings } from "@/lib/settings/server";
import { SupabaseStore } from "@/lib/server/supabase-store";
import { MetaSender } from "@/lib/whatsapp/graph";
import { qstashClient } from "@/lib/qstash";

const STATUSES = ["booked", "confirmed", "cancelled", "completed", "no_show"] as const;

/** Day and time of a booking in the business timezone, e.g. "Thu, 15 Oct 2026 at 10:30 AM". */
function bookingWhen(startsAt: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(startsAt));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${formatDay(`${get("year")}-${get("month")}-${get("day")}`)} at ${timeLabel(`${get("hour")}:${get("minute")}`)}`;
}

/**
 * Changes a booking's status or notes. Cancelling also cancels its reminder.
 * With `notify`, the customer is told on WhatsApp (only inside the 24-hour window).
 */
export async function updateBookingAction(input: { bookingId: string; status?: (typeof STATUSES)[number]; notes?: string; notify?: boolean }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "staff", limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const parsed = z
      .object({ bookingId: z.uuid(), status: z.enum(STATUSES).optional(), notes: z.string().max(2000).optional(), notify: z.boolean().optional() })
      .parse(input);
    const supabase = await createClient();
    const patch: Record<string, unknown> = {};
    if (parsed.status) patch.status = parsed.status;
    if (parsed.notes !== undefined) patch.notes = parsed.notes || null;
    const { data: booking, error } = await supabase
      .from("bookings")
      .update(patch)
      .eq("id", parsed.bookingId)
      .select("id, conversation_id, starts_at, timezone, service, is_test")
      .single();
    if (error) throw new Error(error.message);

    if (parsed.status === "cancelled") {
      const { data: jobs } = await createAdminClient()
        .from("scheduled_jobs")
        .update({ status: "cancelled", last_error: "booking_cancelled" })
        .eq("booking_id", booking.id)
        .eq("status", "scheduled")
        .select("qstash_message_id");
      for (const j of jobs ?? []) if (j.qstash_message_id) await qstashClient().messages.cancel(j.qstash_message_id).catch(() => undefined);
    }

    let notified = false;
    if (parsed.notify && (parsed.status === "cancelled" || parsed.status === "confirmed")) {
      const store = new SupabaseStore();
      const ctx = await store.getConversationContext(booking.conversation_id);
      const settings = await loadSettings();
      if (ctx && !ctx.contact.optedOut && isWindowOpen(ctx.conversation.lastInboundAt, new Date(), settings)) {
        const when = bookingWhen(booking.starts_at, booking.timezone);
        const text =
          parsed.status === "cancelled"
            ? `Your booking for ${when} has been cancelled. Reply here if you'd like another time.`
            : `✅ Your booking for ${when} is confirmed. See you then!`;
        const key = `booking:${booking.id}:${parsed.status}`;
        const claim = await store.claimOutbound({
          idempotencyKey: key,
          conversationId: ctx.conversation.id,
          contactId: ctx.contact.id,
          executionId: null,
          nodeId: null,
          message: { kind: "text", text },
          preview: text,
          mediaAssetId: null,
          isTest: booking.is_test,
          sentBy: session.userId,
        });
        if (claim.status === "new") {
          try {
            const { waMessageId } = await new MetaSender().send({ to: ctx.contact.waId, phoneNumberId: ctx.conversation.phoneNumberId, message: { kind: "text", text } });
            await store.completeOutbound(key, { waMessageId });
            notified = true;
          } catch (e) {
            await store.completeOutbound(key, { error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
    }
    await audit(session, "booking.updated", { type: "booking", id: booking.id }, { ...patch, notified });
    revalidatePath("/bookings");
    return { notified };
  });
}
