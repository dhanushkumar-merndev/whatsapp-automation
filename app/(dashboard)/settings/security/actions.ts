"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAdmin, runAction } from "@/lib/auth/guard";
import { getRateLimiter } from "@/lib/ratelimit";

/** Replace authenticator, step 1: create a new (unverified) TOTP factor. Requires an aal2 session. */
export async function startFactorReplacementAction() {
  return runAction(async () => {
    await requireAdmin({ role: "staff" });
    const supabase = await createClient();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().replace(/[:.]/g, "-")}`,
      issuer: "Star Growth Hub",
    });
    if (error || !data) throw new Error(error?.message ?? "Could not start enrollment");
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  });
}

/** Step 2: verify the new factor, then remove the old ones. */
export async function confirmFactorReplacementAction(input: { factorId: string; code: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "staff" });
    const { factorId, code } = z.object({ factorId: z.string().min(1), code: z.string().regex(/^\d{6}$/) }).parse(input);
    const r = await getRateLimiter().limit(session.userId, { prefix: "mfa", tokens: 5, windowSeconds: 600 });
    if (!r.success) throw new Error("Too many attempts. Try again in a few minutes.");
    const supabase = await createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new Error("That code is not valid");
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.totp ?? []) {
      if (f.id !== factorId && f.status === "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    await audit(session, "mfa.factor_replaced", { type: "profile", id: session.userId });
  });
}

export async function changePasswordAction(input: { password: string; confirm: string }) {
  return runAction(async () => {
    const session = await requireAdmin({ role: "staff", limit: { prefix: "password_change", tokens: 5, windowSeconds: 3600 } });
    const { password, confirm } = z
      .object({
        password: z.string().min(10, "Use at least 10 characters").max(200).refine((p) => /[a-z]/i.test(p) && /\d/.test(p), "Use letters and numbers"),
        confirm: z.string(),
      })
      .parse(input);
    if (password !== confirm) throw new Error("Passwords do not match");
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    await audit(session, "auth.password_changed", { type: "profile", id: session.userId });
  });
}
