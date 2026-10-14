import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-panel";
import { EnrollForm } from "@/components/auth/enroll-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { getAuthState } from "@/lib/auth/guard";
import { STEP_PATHS } from "@/lib/auth/steps";

export const metadata: Metadata = { title: "Set up two-factor authentication" };

export default async function EnrollPage() {
  const state = await getAuthState();
  if (state.step === "ok") redirect("/overview");
  if (state.step !== "enroll") redirect(STEP_PATHS[state.step]);
  return (
    <AuthPanel
      title="Secure your account"
      description="Scan the QR code with Google Authenticator, Microsoft Authenticator or any authenticator app. You only do this once."
    >
      <div className="space-y-4">
        <EnrollForm />
        <LogoutButton variant="link" className="w-full" label="Cancel and sign out" />
      </div>
    </AuthPanel>
  );
}
