"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { isAllowedMime, MEDIA_RULES, sanitizeFileName, sniffMime } from "@/lib/media/validate";

const limits = { prefix: "media_write", tokens: 30, windowSeconds: 600 };

/** Step 1: validate metadata and hand out a one-time signed upload URL. */
export async function createUploadAction(input: { name: string; mimeType: string; size: number }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: limits });
    const { name, mimeType, size } = z.object({ name: z.string().min(1).max(255), mimeType: z.string(), size: z.number().int().positive() }).parse(input);
    if (!isAllowedMime(mimeType)) throw new Error("Unsupported file type. Use PDF, JPG, PNG, MP4 or 3GP.");
    const rule = MEDIA_RULES[mimeType];
    if (size > rule.maxBytes) throw new Error(`File too large. Maximum for ${rule.kind}s is ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`);
    const admin = createAdminClient();
    const path = `assets/${crypto.randomUUID()}.${rule.ext}`;
    const { data: asset, error } = await admin
      .from("media_assets")
      .insert({ name: sanitizeFileName(name), kind: rule.kind, mime_type: mimeType, size_bytes: size, storage_path: path, status: "pending", uploaded_by: session.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { data: signed, error: signError } = await admin.storage.from("media").createSignedUploadUrl(path);
    if (signError || !signed) throw new Error(signError?.message ?? "Could not create upload URL");
    return { assetId: asset.id as string, path, token: signed.token };
  });
}

/** Step 2: verify the uploaded object (size, magic bytes, declared type) and mark it ready. */
export async function finalizeUploadAction(input: { assetId: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: limits });
    const assetId = z.uuid().parse(input.assetId);
    const admin = createAdminClient();
    const { data: asset } = await admin.from("media_assets").select("*").eq("id", assetId).single();
    if (!asset || asset.status !== "pending") throw new Error("Upload not found");
    const reject = async (reason: string) => {
      await admin.storage.from("media").remove([asset.storage_path]);
      await admin.from("media_assets").update({ status: "rejected", rejection_reason: reason }).eq("id", assetId);
      throw new Error(reason);
    };
    const { data: blob, error } = await admin.storage.from("media").download(asset.storage_path);
    if (error || !blob) await reject("The upload did not complete. Please try again.");
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    const rule = MEDIA_RULES[asset.mime_type as keyof typeof MEDIA_RULES];
    if (!rule || bytes.length > rule.maxBytes) await reject("File is larger than allowed.");
    const sniffed = sniffMime(bytes.subarray(0, 16));
    if (sniffed !== asset.mime_type && !(sniffed === "video/mp4" && asset.mime_type === "video/3gpp")) {
      await reject("The file content does not match its type (possible renamed or corrupted file).");
    }
    const checksum = createHash("sha256").update(bytes).digest("hex");
    await admin.from("media_assets").update({ status: "ready", size_bytes: bytes.length, checksum_sha256: checksum }).eq("id", assetId);
    await audit(session, "media.uploaded", { type: "media_asset", id: assetId }, { name: asset.name, size: bytes.length });
    revalidatePath("/media");
  });
}

export async function renameMediaAction(input: { assetId: string; name: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: limits });
    const { assetId, name } = z.object({ assetId: z.uuid(), name: z.string().trim().min(1).max(120) }).parse(input);
    const { error } = await createAdminClient().from("media_assets").update({ name: sanitizeFileName(name) }).eq("id", assetId);
    if (error) throw new Error(error.message);
    await audit(session, "media.renamed", { type: "media_asset", id: assetId });
    revalidatePath("/media");
  });
}

/** Deletes a file only when no draft or live flow version still uses it. */
export async function deleteMediaAction(input: { assetId: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: limits });
    const assetId = z.uuid().parse(input.assetId);
    const admin = createAdminClient();
    const { data: flows } = await admin
      .from("flows")
      .select("name, status, draft_definition, flow_versions!flows_published_version_fk(definition)")
      .neq("status", "archived");
    const users = (flows ?? []).filter((f) => {
      const live = (Array.isArray(f.flow_versions) ? f.flow_versions[0] : f.flow_versions) as { definition: unknown } | null;
      return JSON.stringify(f.draft_definition).includes(assetId) || JSON.stringify(live?.definition ?? "").includes(assetId);
    });
    if (users.length) throw new Error(`This file is used by: ${users.map((f) => f.name).join(", ")}. Remove it from those flows (and publish) first.`);
    const { data: asset } = await admin.from("media_assets").select("storage_path").eq("id", assetId).single();
    if (asset) await admin.storage.from("media").remove([asset.storage_path]);
    await admin.from("media_assets").update({ deleted_at: new Date().toISOString(), status: "rejected", meta_media_id: null }).eq("id", assetId);
    await audit(session, "media.deleted", { type: "media_asset", id: assetId });
    revalidatePath("/media");
  });
}
