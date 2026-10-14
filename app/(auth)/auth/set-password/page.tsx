import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { getAuthState } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage() {
  const state = await getAuthState();
  if (state.step === "login" || state.step === "denied") redirect("/login?error=link_invalid");
  if (state.step === "verify") redirect("/mfa/verify?next=/auth/set-password");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set your password</CardTitle>
        <CardDescription>Choose a password for your administrator account.</CardDescription>
      </CardHeader>
      <CardContent>
        <SetPasswordForm />
      </CardContent>
    </Card>
  );
}
