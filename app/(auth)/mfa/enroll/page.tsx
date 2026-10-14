import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" /> Set up two-factor authentication
        </CardTitle>
        <CardDescription>
          Required for every administrator. You only do this once — after that, sign-in asks for a 6-digit code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <EnrollForm />
        <LogoutButton variant="link" className="w-full" label="Cancel and sign out" />
      </CardContent>
    </Card>
  );
}
