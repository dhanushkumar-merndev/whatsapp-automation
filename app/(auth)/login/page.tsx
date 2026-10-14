import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Administrator access only.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next} initialError={error} />
      </CardContent>
    </Card>
  );
}
