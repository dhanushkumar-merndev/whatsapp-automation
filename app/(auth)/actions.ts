"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRateLimiter, hashIdentifier } from "@/lib/ratelimit";
import { loadSettings } from "@/lib/settings/server";
import { audit, clientIp, getAuthState } from "@/lib/auth/guard";
import { loginInputSchema, loginToAuthEmail } from "@/lib/auth/login-id";

export type FormState = { error?: string; message?: string } | undefined;

function safeNext(next: unknown): string {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") && !v.startsWith("/mfa") ? v : "/overview";
}

async function recordSecurityEvent(scope: string, identifier: string, detail?: Record<string, unknown>, userId?: string) {
  await createAdminClient()
    .from("rate_limit_events")
    .insert({ scope, identifier: hashIdentifier(identifier), user_id: userId ?? null, action: "blocked", detail: detail ?? null });
}

// ---------------------------------------------------------------------------
// Password sign-in (step 1)
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  login: loginInputSchema,
  password: z.string().min(1, "Enter your password").max(200),
  next: z.string().optional(),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    login: formData.get("login"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  let email: string;
  try {
    email = loginToAuthEmail(parsed.data.login);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid login" };
  }

  const settings = await loadSettings();
  const rule = {
    prefix: "login",
    tokens: settings.rateLimits.loginAttempts,
    windowSeconds: settings.rateLimits.loginWindowMinutes * 60,
  };
  const ip = await clientIp();
  const limiter = getRateLimiter();
  const [byIp, byAccount] = await Promise.all([limiter.limit(`ip:${ip}`, rule), limiter.limit(`acct:${email}`, rule)]);
  if (!byIp.success || !byAccount.success) {
    await recordSecurityEvent("login", `${ip}|${email}`, { reason: "rate_limited" });
    const minutes = Math.max(1, Math.ceil((Math.max(byIp.reset, byAccount.reset) - Date.now()) / 60000));
    return { error: `Too many sign-in attempts. Try again in about ${minutes} minute(s).` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) {
    return { error: "Invalid login or password." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("id, status, role").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.status === "disabled") {
    await supabase.auth.signOut();
    await recordSecurityEvent("login", email, { reason: profile ? "disabled" : "no_profile" }, profile?.id);
    return { error: "This account is not authorised to use this application." };
  }
  await admin.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", profile.id);

  // Decide the MFA step from the freshly created session (skipped while MFA is switched off).
  const nextPath = safeNext(parsed.data.next);
  if (!(await loadSettings()).security.mfaRequired) redirect(nextPath);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.nextLevel !== "aal2") redirect("/mfa/enroll"); // no verified factor yet → QR enrollment
  if (aal.currentLevel !== "aal2") redirect(`/mfa/verify?next=${encodeURIComponent(nextPath)}`);
  redirect(nextPath);
}

// ---------------------------------------------------------------------------
// MFA enrollment (first login only)
// ---------------------------------------------------------------------------

export type EnrollmentData = { factorId: string; qrCode: string; secret: string; uri: string };

export async function beginEnrollment(): Promise<{ ok: true; data: EnrollmentData } | { ok: false; error: string }> {
  const state = await getAuthState();
  if (state.step !== "enroll") {
    return { ok: false, error: state.step === "login" ? "Your session has expired. Please sign in again." : "MFA is already set up." };
  }
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  // Remove abandoned, never-verified factors so a fresh QR code can be issued.
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    issuer: "Star Growth Hub",
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Could not start MFA enrollment" };
  return { ok: true, data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri } };
}

const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");

async function mfaRateLimit(userId: string): Promise<string | null> {
  const settings = await loadSettings();
  const r = await getRateLimiter().limit(userId, {
    prefix: "mfa",
    tokens: settings.rateLimits.mfaAttempts,
    windowSeconds: settings.rateLimits.mfaWindowMinutes * 60,
  });
  if (r.success) return null;
  await recordSecurityEvent("mfa_verify", userId, { reason: "rate_limited" }, userId);
  const minutes = Math.max(1, Math.ceil((r.reset - Date.now()) / 60000));
  return `Too many incorrect codes. Try again in about ${minutes} minute(s).`;
}

export async function verifyEnrollmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { error: code.error.issues[0]?.message };
  const factorId = String(formData.get("factorId") ?? "");
  if (!factorId) return { error: "Enrollment expired. Reload the page to get a new QR code." };

  const state = await getAuthState();
  if (state.step !== "enroll" || !state.session) {
    return { error: state.step === "login" ? "Your session has expired. Please sign in again." : "MFA is already set up." };
  }
  const limited = await mfaRateLimit(state.session.userId);
  if (limited) return { error: limited };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.data });
  if (error) return { error: "That code is not valid. Check the time on your phone and try again." };

  await createAdminClient()
    .from("profiles")
    .update({ status: "active", mfa_enrolled_at: new Date().toISOString() })
    .eq("id", state.session.userId)
    .neq("status", "disabled");
  await audit(state.session, "mfa.enrolled", { type: "profile", id: state.session.userId });
  redirect("/overview");
}

// ---------------------------------------------------------------------------
// MFA verification (every subsequent login)
// ---------------------------------------------------------------------------

export async function verifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = codeSchema.safeParse(formData.get("code"));
  if (!code.success) return { error: code.error.issues[0]?.message };

  const state = await getAuthState();
  if (state.step === "login" || !state.session) return { error: "Your session has expired. Please sign in again." };
  if (state.step === "enroll") redirect("/mfa/enroll");
  if (state.step === "ok") redirect(safeNext(formData.get("next")));

  const limited = await mfaRateLimit(state.session.userId);
  if (limited) return { error: limited };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = (factors?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) redirect("/mfa/enroll");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  if (error) return { error: "That code is not valid. Check the time on your phone and try again." };
  await audit(state.session, "auth.signed_in", { type: "profile", id: state.session.userId });
  redirect(safeNext(formData.get("next")));
}

// ---------------------------------------------------------------------------
// Sign out / set password (invites)
// ---------------------------------------------------------------------------

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), "Use letters and numbers");

export async function setPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const pw = passwordSchema.safeParse(formData.get("password"));
  if (!pw.success) return { error: pw.error.issues[0]?.message };
  if (pw.data !== formData.get("confirm")) return { error: "Passwords do not match" };

  const state = await getAuthState();
  if (state.step === "login" || !state.session) return { error: "Your link has expired. Ask an administrator for a new invite." };
  // Accounts that already use MFA must be at aal2 to change their password.
  if (state.step === "verify") redirect("/mfa/verify?next=/auth/set-password");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { error: error.message };
  await audit(state.session, "auth.password_set", { type: "profile", id: state.session.userId });
  redirect(state.step === "enroll" ? "/mfa/enroll" : "/overview");
}
