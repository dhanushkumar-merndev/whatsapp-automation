"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { encryptSecret } from "@/lib/crypto";
import { assertSafeUrl, checkUrlShape } from "@/lib/crm/ssrf";
import { HttpCrmDispatcher } from "@/lib/crm/dispatch";
import { CRM_SOURCE_FIELDS } from "@/lib/engine/crm-payload";
import { attemptCrmDelivery } from "@/lib/engine/crm-attempt";
import { crmUrlPolicy, createPipelineDeps } from "@/lib/server/pipeline";
import { toIntegration } from "@/lib/server/supabase-store";

const limits = { prefix: "admin_write", tokens: 60, windowSeconds: 60 };

const integrationSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(8).max(500),
  enabled: z.boolean(),
  authType: z.enum(["none", "bearer", "basic", "header"]),
  /** Empty strings mean "keep the stored value". */
  credentials: z.object({
    token: z.string().max(2000).default(""),
    username: z.string().max(200).default(""),
    password: z.string().max(500).default(""),
    headerName: z.string().max(100).regex(/^[A-Za-z0-9-]*$/, "Header names may contain letters, numbers and dashes").default(""),
    headerValue: z.string().max(2000).default(""),
  }),
  signing: z.enum(["keep", "generate", "none"]),
  fieldMapping: z.record(z.string(), z.string().max(80).regex(/^[A-Za-z0-9_.\-]*$/, "Use letters, numbers, _ . -")),
});

export async function saveIntegrationAction(input: z.input<typeof integrationSchema>) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: limits });
    const v = integrationSchema.parse(input);
    const policy = crmUrlPolicy();
    checkUrlShape(v.url, policy);
    if (v.enabled) await assertSafeUrl(v.url, policy);

    const admin = createAdminClient();
    const existing = v.id ? (await admin.from("crm_integrations").select("*").eq("id", v.id).single()).data : null;
    const previous = existing ? toIntegration(existing) : null;
    const merged = {
      token: v.credentials.token || previous?.credentials.token || "",
      username: v.credentials.username || previous?.credentials.username || "",
      password: v.credentials.password || previous?.credentials.password || "",
      headerName: v.credentials.headerName || previous?.credentials.headerName || "",
      headerValue: v.credentials.headerValue || previous?.credentials.headerValue || "",
    };
    const relevant =
      v.authType === "bearer"
        ? { token: merged.token }
        : v.authType === "basic"
          ? { username: merged.username, password: merged.password }
          : v.authType === "header"
            ? { headerName: merged.headerName, headerValue: merged.headerValue }
            : {};
    if (v.authType === "bearer" && !merged.token) throw new Error("Enter the bearer token");
    if (v.authType === "basic" && !merged.username) throw new Error("Enter the username");
    if (v.authType === "header" && (!merged.headerName || !merged.headerValue)) throw new Error("Enter the header name and value");

    let newSecret: string | null = null;
    let signingEncrypted: string | null = existing?.signing_secret_encrypted ?? null;
    if (v.signing === "generate") {
      newSecret = `whsec_${randomBytes(24).toString("base64url")}`;
      signingEncrypted = encryptSecret(newSecret);
    } else if (v.signing === "none") {
      signingEncrypted = null;
    }
    const mapping = Object.fromEntries(Object.entries(v.fieldMapping).filter(([k]) => (CRM_SOURCE_FIELDS as readonly string[]).includes(k)));
    const row = {
      name: v.name,
      url: v.url,
      enabled: v.enabled,
      auth_type: v.authType,
      credentials_encrypted: Object.keys(relevant).length ? encryptSecret(JSON.stringify(relevant)) : null,
      signing_secret_encrypted: signingEncrypted,
      field_mapping: mapping,
    };
    const res = v.id
      ? await admin.from("crm_integrations").update(row).eq("id", v.id).select("id").single()
      : await admin.from("crm_integrations").insert({ ...row, created_by: session.userId }).select("id").single();
    if (res.error) throw new Error(res.error.message);
    await audit(session, v.id ? "crm.updated" : "crm.created", { type: "crm_integration", id: res.data.id }, { enabled: v.enabled, authType: v.authType });
    revalidatePath("/crm");
    // The signing secret is shown exactly once.
    return { id: res.data.id as string, signingSecret: newSecret };
  });
}

export async function testIntegrationAction(input: { id: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "crm_test", tokens: 20, windowSeconds: 600 } });
    const id = z.uuid().parse(input.id);
    const admin = createAdminClient();
    const { data } = await admin.from("crm_integrations").select("*").eq("id", id).single();
    if (!data) throw new Error("Integration not found");
    const integration = toIntegration(data);
    const eventId = `test:${crypto.randomUUID()}`;
    const result = await new HttpCrmDispatcher(crmUrlPolicy()).deliver(integration, {
      id: "test",
      integrationId: id,
      leadId: "test",
      eventId,
      eventType: "test.ping",
      payload: { event_id: eventId, event_type: "test.ping", occurred_at: new Date().toISOString(), data: { message: "Test from Star Growth Hub WhatsApp" } },
      status: "pending",
      attempts: 0,
      maxAttempts: 1,
      isTest: true,
    });
    await admin
      .from("crm_integrations")
      .update(result.ok ? { last_success_at: new Date().toISOString(), last_error: null } : { last_failure_at: new Date().toISOString(), last_error: result.error })
      .eq("id", id);
    await audit(session, "crm.tested", { type: "crm_integration", id }, { ok: result.ok, status: result.statusCode });
    revalidatePath("/crm");
    return result;
  });
}

export async function deleteIntegrationAction(input: { id: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: limits });
    const id = z.uuid().parse(input.id);
    const { error } = await createAdminClient().from("crm_integrations").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await audit(session, "crm.deleted", { type: "crm_integration", id });
    revalidatePath("/crm");
  });
}

export async function retryDeliveryAction(input: { deliveryId: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "crm_retry", tokens: 30, windowSeconds: 600 } });
    const deliveryId = z.uuid().parse(input.deliveryId);
    const admin = createAdminClient();
    const { data: d } = await admin.from("crm_deliveries").select("*, crm_integrations(*)").eq("id", deliveryId).single();
    if (!d) throw new Error("Delivery not found");
    if (d.status === "succeeded") return "already delivered";
    const integration = toIntegration(d.crm_integrations as Record<string, unknown>);
    if (!integration.enabled) throw new Error("Enable the integration first.");
    await admin.from("crm_deliveries").update({ attempts: 0, status: "pending" }).eq("id", deliveryId);
    const outcome = await attemptCrmDelivery(await createPipelineDeps("crm.manual_retry"), integration, {
      id: d.id,
      integrationId: d.integration_id,
      leadId: d.lead_id,
      eventId: d.event_id,
      eventType: d.event_type,
      payload: d.payload,
      status: "pending",
      attempts: 0,
      maxAttempts: d.max_attempts,
      isTest: d.is_test,
    });
    await audit(session, "crm.delivery_retried", { type: "crm_delivery", id: deliveryId }, { outcome });
    revalidatePath("/crm");
    return outcome;
  });
}
