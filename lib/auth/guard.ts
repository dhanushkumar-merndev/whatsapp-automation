import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRateLimiter, hashIdentifier } from "@/lib/ratelimit";
import { resolveAuthStep, roleAllows, STEP_PATHS, type AuthStep, type Role } from "./steps";

export interface AdminSession {
  userId: string;
  email: string;
  loginId: string | null;
  fullName: string | null;
  role: Role;
}

export interface AuthState {
  step: AuthStep;
  session: AdminSession | null;
}

export class AuthzError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 429,
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

/** Resolves the caller's authentication/MFA state. Cached per request. */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) return { step: "login", session: null };

  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("id, email, login_id, full_name, role, status")
    .eq("id", userId)
    .maybeSingle();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified").length;
  const aal = typeof claims?.aal === "string" ? claims.aal : null;

  const step = resolveAuthStep({
    userId,
    profile: profile ? { status: profile.status, role: profile.role } : null,
    verifiedTotpFactors: verified,
    aal,
  });

  const session: AdminSession | null = profile
    ? {
        userId,
        email: profile.email,
        loginId: profile.login_id,
        fullName: profile.full_name,
        role: profile.role,
      }
    : null;

  if (step === "ok" && profile?.status === "invited") {
    // First successful MFA-verified sign-in activates an invited account.
    await createAdminClient()
      .from("profiles")
      .update({ status: "active", mfa_enrolled_at: new Date().toISOString() })
      .eq("id", userId);
  }
  return { step, session };
});

/** For Server Components: redirect unless the caller has a fully MFA-verified session. */
export async function requirePageSession(role: Role = "staff"): Promise<AdminSession> {
  const state = await getAuthState();
  if (state.step !== "ok" || !state.session) redirect(STEP_PATHS[state.step === "ok" ? "login" : state.step]);
  if (!roleAllows(state.session.role, role)) redirect("/overview?error=forbidden");
  return state.session;
}

/**
 * For Server Actions and Route Handlers: throws AuthzError unless the caller
 * has an aal2 session with the required role. Optionally rate-limits writes.
 */
export async function requireAdmin(
  opts: { role?: Role; limit?: { prefix: string; tokens: number; windowSeconds: number } } = {},
): Promise<AdminSession> {
  const state = await getAuthState();
  if (state.step === "login") throw new AuthzError("Not signed in", 401);
  if (state.step !== "ok" || !state.session) throw new AuthzError("Multi-factor authentication required", 401);
  if (!roleAllows(state.session.role, opts.role ?? "admin")) throw new AuthzError("Forbidden", 403);
  if (opts.limit) {
    const r = await getRateLimiter().limit(state.session.userId, opts.limit);
    if (!r.success) {
      await createAdminClient().from("rate_limit_events").insert({
        scope: opts.limit.prefix,
        identifier: hashIdentifier(state.session.userId),
        user_id: state.session.userId,
        action: "blocked",
      });
      throw new AuthzError("Too many requests. Please wait a moment and try again.", 429);
    }
  }
  return state.session;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function audit(
  actor: AdminSession | null,
  action: string,
  entity?: { type: string; id?: string | null },
  detail?: Record<string, unknown>,
) {
  let ip: string | null = null;
  try {
    ip = hashIdentifier(await clientIp());
  } catch {
    ip = null;
  }
  await createAdminClient()
    .from("audit_logs")
    .insert({
      actor_id: actor?.userId ?? null,
      actor_type: actor ? "user" : "system",
      action,
      entity_type: entity?.type ?? null,
      entity_id: entity?.id ?? null,
      detail: detail ?? null,
      ip,
    });
}

/** Standard result type for server actions. */
export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AuthzError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw e; // let Next.js redirects / notFound propagate
    }
    console.error("[action] failed", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}
