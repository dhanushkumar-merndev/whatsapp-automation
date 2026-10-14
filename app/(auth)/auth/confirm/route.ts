import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles Supabase email links (invite / recovery) using the token-hash flow.
 * Configure the Supabase email templates to link to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
 */
const ALLOWED: EmailOtpType[] = ["invite", "recovery", "email", "magiclink"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const target = new URL("/auth/set-password", url.origin);

  if (tokenHash && type && ALLOWED.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(target);
  }
  return NextResponse.redirect(new URL("/login?error=link_invalid", url.origin));
}
