"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { fetchPhoneNumberInfo } from "@/lib/whatsapp/graph";

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
