import type { Metadata } from "next";
import { ChangePassword, ReplaceAuthenticator } from "@/components/settings/security-panel";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  await requirePageSession("staff");
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).filter((f) => f.status === "verified").length;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ReplaceAuthenticator factorCount={verified} />
      <ChangePassword />
      <div className="rounded-2xl border p-4 text-sm text-muted-foreground lg:col-span-2">
        Lost your phone? Another owner or admin can reset your authenticator from Settings → Users after confirming with their own code. If you
        are the only owner, the server operator can run <code>pnpm mfa:reset &lt;login&gt;</code>. MFA is never bypassed — you always set up a new
        authenticator before accessing data.
      </div>
    </div>
  );
}
