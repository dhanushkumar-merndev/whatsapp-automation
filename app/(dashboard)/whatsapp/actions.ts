"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import {
  clearAccessTokenCache,
  exchangeSignupCode,
  fetchPhoneNumberInfo,
  requestAppSync,
  subscribeAppToWaba,
  accessTokenFor,
} from "@/lib/whatsapp/graph";

const accountSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "WABA ID is numeric"),
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "Phone number ID is numeric"),
  enabled: z.boolean(),
});

export async function saveAccountAction(input: z.input<typeof accountSchema>) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const v = accountSchema.parse(input);
    const supabase = await createClient();
    const row = { name: v.name, waba_id: v.wabaId, phone_number_id: v.phoneNumberId, enabled: v.enabled };
    const res = v.id ? await supabase.from("whatsapp_accounts").update(row).eq("id", v.id) : await supabase.from("whatsapp_accounts").insert(row);
    if (res.error) throw new Error(res.error.code === "23505" ? "This phone number ID is already registered." : res.error.message);
    clearAccessTokenCache();
    await audit(session, v.id ? "whatsapp_account.updated" : "whatsapp_account.created", { type: "whatsapp_account", id: v.id }, row);
    revalidatePath("/whatsapp");
  });
}

/** Calls the Graph API with the server-side token and stores the phone number details. */
export async function testAccountAction(input: { id: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "wa_test", tokens: 20, windowSeconds: 600 } });
    const id = z.uuid().parse(input.id);
    const supabase = await createClient();
    const { data: acc } = await supabase.from("whatsapp_accounts").select("phone_number_id").eq("id", id).single();
    if (!acc) throw new Error("Account not found");
    const info = await fetchPhoneNumberInfo(acc.phone_number_id);
    await supabase
      .from("whatsapp_accounts")
      .update({
        display_phone_number: info.display_phone_number ?? null,
        verified_name: info.verified_name ?? null,
        quality_rating: info.quality_rating ?? null,
        last_verified_at: new Date().toISOString(),
        metadata: { platform_type: info.platform_type, throughput: info.throughput?.level, code_verification_status: info.code_verification_status },
      })
      .eq("id", id);
    await audit(session, "whatsapp_account.tested", { type: "whatsapp_account", id });
    revalidatePath("/whatsapp");
    return info;
  });
}

/** Removes a disabled number. Numbers with conversation history are kept (the FK is ON DELETE RESTRICT). */
export async function deleteAccountAction(input: { id: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const id = z.uuid().parse(input.id);
    const supabase = await createClient();
    const { data: acc } = await supabase.from("whatsapp_accounts").select("name, enabled").eq("id", id).maybeSingle();
    if (!acc) throw new Error("Account not found");
    if (acc.enabled) throw new Error("Disable this number before removing it.");
    const { error } = await supabase.from("whatsapp_accounts").delete().eq("id", id);
    if (error) {
      throw new Error(
        error.code === "23503" ? "This number has conversation history, so it can't be removed. It stays disabled instead." : error.message,
      );
    }
    await audit(session, "whatsapp_account.deleted", { type: "whatsapp_account", id }, { name: acc.name });
    revalidatePath("/whatsapp");
  });
}

export interface ConnectStep {
  label: string;
  ok: boolean;
  detail?: string;
}

const numericId = z.string().trim().regex(/^\d{5,25}$/);

/**
 * Finishes "Connect WhatsApp Business app number" (Meta Embedded Signup with
 * coexistence): exchanges the one-time code for the number's token, subscribes
 * this app to its webhooks, registers the number here, and asks the phone app to
 * share contacts and chat history (each possible once, within 24 hours).
 */
export async function connectBusinessAppAction(input: { code: string; wabaId: string; phoneNumberId: string; coexistence: boolean }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "wa_connect", tokens: 10, windowSeconds: 600 } });
    const v = z.object({ code: z.string().min(10).max(2000), wabaId: numericId, phoneNumberId: numericId, coexistence: z.boolean() }).parse(input);
    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    if (!appId) throw new Error("NEXT_PUBLIC_META_APP_ID is not set.");
    const steps: ConnectStep[] = [];

    const token = await exchangeSignupCode(v.code, appId);
    steps.push({ label: "Signed in to your WhatsApp Business account", ok: true });
    await subscribeAppToWaba(v.wabaId, token);
    steps.push({ label: "This app now receives the number's messages", ok: true });
    const info = await fetchPhoneNumberInfo(v.phoneNumberId, token);

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data: account, error } = await admin
      .from("whatsapp_accounts")
      .upsert(
        {
          name: info.verified_name ?? "WhatsApp Business app",
          waba_id: v.wabaId,
          phone_number_id: v.phoneNumberId,
          enabled: true,
          access_token_encrypted: encryptSecret(token),
          coexistence: v.coexistence,
          is_on_biz_app: info.is_on_biz_app ?? null,
          onboarded_at: now,
          display_phone_number: info.display_phone_number ?? null,
          verified_name: info.verified_name ?? null,
          quality_rating: info.quality_rating ?? null,
          last_verified_at: now,
          metadata: { platform_type: info.platform_type, throughput: info.throughput?.level },
        },
        { onConflict: "phone_number_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    clearAccessTokenCache();
    steps.push({
      label: `Number ${info.display_phone_number ?? v.phoneNumberId} added`,
      ok: true,
      detail: v.coexistence ? (info.is_on_biz_app ? "Works in the WhatsApp Business app and here." : "Meta does not report it as a Business app number yet.") : undefined,
    });

    if (v.coexistence) {
      for (const [kind, label, column] of [
        ["smb_app_state_sync", "Phone contacts shared", "contacts_sync_requested_at"],
        ["history", "Chat history requested (arrives over the next minutes)", "history_sync_requested_at"],
      ] as const) {
        try {
          await requestAppSync(v.phoneNumberId, kind, token);
          await admin.from("whatsapp_accounts").update({ [column]: new Date().toISOString() }).eq("id", account.id);
          steps.push({ label, ok: true });
        } catch (e) {
          steps.push({ label, ok: false, detail: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    await audit(session, "whatsapp_account.connected", { type: "whatsapp_account", id: account.id }, { coexistence: v.coexistence, wabaId: v.wabaId });
    revalidatePath("/whatsapp");
    return steps;
  });
}

/** Retries the one-time contacts / history share for a connected Business app number (within 24 hours). */
export async function retryAppSyncAction(input: { id: string; kind: "smb_app_state_sync" | "history" }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "wa_connect", tokens: 10, windowSeconds: 600 } });
    const { id, kind } = z.object({ id: z.uuid(), kind: z.enum(["smb_app_state_sync", "history"]) }).parse(input);
    const admin = createAdminClient();
    const { data: acc } = await admin.from("whatsapp_accounts").select("phone_number_id, onboarded_at").eq("id", id).single();
    if (!acc) throw new Error("Account not found");
    if (acc.onboarded_at && Date.now() - new Date(acc.onboarded_at).getTime() > 24 * 3_600_000) {
      throw new Error("Meta allows this only within 24 hours of connecting. Disconnect the number in WhatsApp Manager and connect it again.");
    }
    const token = await accessTokenFor({ phoneNumberId: acc.phone_number_id });
    if (!token) throw new Error("No token for this number.");
    await requestAppSync(acc.phone_number_id, kind, token);
    await admin
      .from("whatsapp_accounts")
      .update({ [kind === "history" ? "history_sync_requested_at" : "contacts_sync_requested_at"]: new Date().toISOString() })
      .eq("id", id);
    await audit(session, "whatsapp_account.sync_requested", { type: "whatsapp_account", id }, { kind });
    revalidatePath("/whatsapp");
  });
}
