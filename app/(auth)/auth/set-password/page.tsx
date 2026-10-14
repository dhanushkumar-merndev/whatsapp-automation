import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-panel";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { getAuthState } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage() {
  const state = await getAuthState();
  if (state.step === "login" || state.step === "denied") redirect("/login?error=link_invalid");
  if (state.step === "verify") redirect("/mfa/verify?next=/auth/set-password");
  return (
    <AuthPanel title="Set your password" description="Choose a password for your administrator account.">
      <SetPasswordForm />
    </AuthPanel>
  );
}
