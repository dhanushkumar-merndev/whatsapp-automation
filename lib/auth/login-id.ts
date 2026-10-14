import { z } from "zod";

/**
 * Supabase password auth needs an email address. Admins may instead use a
 * login ID such as "Gayathri@2026": it is mapped deterministically to an
 * internal, non-deliverable address so the same ID always reaches the same
 * account. Password recovery for login-ID accounts goes through another
 * owner/admin (Settings → Users) — never by bypassing MFA.
 */
export const LOGIN_ID_DOMAIN = "login.sgh.internal";

const emailSchema = z.email();

export function isEmail(value: string): boolean {
  return emailSchema.safeParse(value.trim()).success;
}

export function normaliseLoginId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function loginToAuthEmail(login: string): string {
  const v = login.trim();
  if (isEmail(v)) return v.toLowerCase();
  const slug = normaliseLoginId(v);
  if (!slug) throw new Error("Enter an email address or login ID");
  return `${slug}@${LOGIN_ID_DOMAIN}`;
}

export function isInternalLoginEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${LOGIN_ID_DOMAIN}`);
}

export const loginInputSchema = z
  .string()
  .trim()
  .min(3, "Enter your email or login ID")
  .max(120);
