import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VerifyForm } from "@/components/auth/verify-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { getAuthState } from "@/lib/auth/guard";
import { STEP_PATHS } from "@/lib/auth/steps";

export const metadata: Metadata = { title: "Enter authentication code" };

export default async function VerifyPage({ searchParams }: PageProps<"/mfa/verify">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const state = await getAuthState();
  if (state.step === "ok") redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview");
  if (state.step !== "verify") redirect(STEP_PATHS[state.step]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" /> Authentication code
        </CardTitle>
        <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <VerifyForm next={next} />
        <Collapsible>
          <CollapsibleTrigger className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
            Lost access to your authenticator?
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
            For security there is no self-service bypass. Ask another owner or admin to reset your two-factor
            authentication from <b>Settings → Users</b>; you will then set up a new authenticator at your next sign-in.
            If you are the only owner, the server operator can run <code>pnpm mfa:reset &lt;login&gt;</code> with the
            service key. Every reset is recorded in the audit log.
          </CollapsibleContent>
        </Collapsible>
        <LogoutButton variant="link" className="w-full" label="Sign out" />
      </CardContent>
    </Card>
  );
}
