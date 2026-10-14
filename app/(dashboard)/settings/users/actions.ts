"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requireAdmin, runAction, type AdminSession } from "@/lib/auth/guard";
import { getRateLimiter } from "@/lib/ratelimit";
import { appUrl } from "@/lib/env";
import { isEmail, loginToAuthEmail } from "@/lib/auth/login-id";

/** Step-up: sensitive actions require a fresh TOTP code from the acting admin. */
async function verifyActorCode(session: AdminSession, code: string) {
  const r = await getRateLimiter().limit(session.userId, { prefix: "mfa_stepup", tokens: 5, windowSeconds: 600 });
  if (!r.success) throw new Error("Too many attempts. Try again in a few minutes.");
  if (!/^\d{6}$/.test(code)) throw new Error("Enter your current 6-digit authenticator code");
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = (data?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) throw new Error("No verified authenticator on your account");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) throw new Error("That authenticator code is not valid");
}

export async function inviteUserAction(input: { login: string; fullName: string; role: "owner" | "admin" | "staff"; method: "email" | "password" }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "user_invite", tokens: 20, windowSeconds: 3600 } });
    const v = z
      .object({
        login: z.string().trim().min(3).max(120),
        fullName: z.string().trim().max(80),
        role: z.enum(["owner", "admin", "staff"]),
        method: z.enum(["email", "password"]),
      })
      .parse(input);
    if (v.role === "owner" && session.role !== "owner") throw new Error("Only an owner can add another owner.");
    const admin = createAdminClient();
    const email = loginToAuthEmail(v.login);
    const loginId = isEmail(v.login) ? null : v.login;
    let userId: string;
    let tempPassword: string | null = null;
    if (v.method === "email") {
      if (!isEmail(v.login)) throw new Error("Email invitations need a real email address. Use a temporary password for login IDs.");
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl()}/auth/confirm` });
      if (error) throw new Error(error.message);
      userId = data.user.id;
    } else {
      tempPassword = randomBytes(12).toString("base64url");
      const { data, error } = await admin.auth.admin.createUser({ email, password: tempPassword, email_confirm: true, user_metadata: { login_id: loginId } });
      if (error) throw new Error(error.message);
      userId = data.user.id;
    }
    const { error } = await admin
      .from("profiles")
      .upsert({ id: userId, email, login_id: loginId, full_name: v.fullName || loginId || email.split("@")[0], role: v.role, status: "invited" });
    if (error) throw new Error(error.message);
    await audit(session, "user.invited", { type: "profile", id: userId }, { role: v.role, method: v.method });
    revalidatePath("/settings/users");
    return { tempPassword };
  });
}

export async function updateUserAction(input: { userId: string; role?: "owner" | "admin" | "staff"; status?: "active" | "disabled" }) {
  return runAction(async () => {
    const session = await requireAdmin({ limit: { prefix: "admin_write", tokens: 60, windowSeconds: 60 } });
    const v = z
      .object({ userId: z.uuid(), role: z.enum(["owner", "admin", "staff"]).optional(), status: z.enum(["active", "disabled"]).optional() })
      .parse(input);
    if (v.userId === session.userId) throw new Error("You cannot change your own role or status.");
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("role, status").eq("id", v.userId).single();
    if (!target) throw new Error("User not found");
    if ((target.role === "owner" || v.role === "owner") && session.role !== "owner") throw new Error("Only an owner can change owners.");
    if (target.role === "owner" && (v.role && v.role !== "owner" || v.status === "disabled")) {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner").eq("status", "active");
      if ((count ?? 0) <= 1) throw new Error("There must always be at least one active owner.");
    }
    const patch: Record<string, unknown> = {};
    if (v.role) patch.role = v.role;
    if (v.status) patch.status = v.status;
    const { error } = await admin.from("profiles").update(patch).eq("id", v.userId);
    if (error) throw new Error(error.message);
    if (v.status) {
      // Block / unblock sign-in at the auth layer too.
      await admin.auth.admin.updateUserById(v.userId, { ban_duration: v.status === "disabled" ? "876000h" : "none" });
    }
    await audit(session, "user.updated", { type: "profile", id: v.userId }, patch);
    revalidatePath("/settings/users");
  });
}

/** Authorised recovery: removes another user's authenticators; they must enroll again. Never bypasses MFA. */
export async function resetUserMfaAction(input: { userId: string; code: string }) {
  return runAction(async () => {
    const session = await requireAdmin();
    const { userId, code } = z.object({ userId: z.uuid(), code: z.string() }).parse(input);
    if (userId === session.userId) throw new Error("Use Settings → Security to replace your own authenticator.");
    await verifyActorCode(session, code);
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (!target) throw new Error("User not found");
    if (target.role === "owner" && session.role !== "owner") throw new Error("Only an owner can reset an owner's MFA.");
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) throw new Error(error.message);
    for (const f of data.factors) {
      const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (delError) throw new Error(delError.message);
    }
    await admin.from("profiles").update({ mfa_enrolled_at: null }).eq("id", userId);
    await audit(session, "user.mfa_reset", { type: "profile", id: userId }, { factorsRemoved: data.factors.length });
    revalidatePath("/settings/users");
    return { removed: data.factors.length };
  });
}
