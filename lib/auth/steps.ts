/**
 * Pure decision logic for the login → MFA flow (unit-tested).
 *
 *  login   – no valid session
 *  denied  – no profile, or the profile is disabled
 *  enroll  – signed in, no verified TOTP factor yet → show QR code (first login only)
 *  verify  – verified factor exists but the session is not aal2 → show 6-digit prompt only
 *  ok      – aal2 session for an active/invited profile
 */
export type AuthStep = "login" | "denied" | "enroll" | "verify" | "ok";

export type Role = "owner" | "admin" | "staff";

export interface AuthStepInput {
  userId: string | null;
  profile: { status: "invited" | "active" | "disabled"; role: Role } | null;
  verifiedTotpFactors: number;
  aal: string | null;
}

export function resolveAuthStep(input: AuthStepInput): AuthStep {
  if (!input.userId) return "login";
  if (!input.profile || input.profile.status === "disabled") return "denied";
  if (input.verifiedTotpFactors === 0) return "enroll";
  if (input.aal !== "aal2") return "verify";
  return "ok";
}

export const STEP_PATHS: Record<Exclude<AuthStep, "ok">, string> = {
  login: "/login",
  denied: "/login?error=access_denied",
  enroll: "/mfa/enroll",
  verify: "/mfa/verify",
};

const RANK: Record<Role, number> = { staff: 1, admin: 2, owner: 3 };

export function roleAllows(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}
