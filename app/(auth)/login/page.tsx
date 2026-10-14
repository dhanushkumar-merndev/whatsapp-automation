import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-panel";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthState } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  access_denied: "This account is not authorised to use this application.",
  session_expired: "Your session expired. Please sign in again.",
  link_invalid: "That sign-in link is invalid or has expired.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const state = await getAuthState();
  if (state.step === "ok") redirect("/overview");
  if (state.step === "enroll") redirect("/mfa/enroll");
  if (state.step === "verify") redirect("/mfa/verify");

  const next = typeof sp.next === "string" ? sp.next : undefined;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  return (
    <AuthPanel title="Welcome back" description="Sign in with your administrator account.">
      <LoginForm next={next} initialError={error} />
    </AuthPanel>
  );
}
