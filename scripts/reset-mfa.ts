/**
 * Break-glass MFA reset for an administrator who lost their authenticator and
 * has no other owner/admin to reset it from Settings → Users.
 * Requires the server-side SUPABASE_SECRET_KEY; never bypasses MFA — the user
 * must enroll a new authenticator at next sign-in. Recorded in audit_logs.
 *   pnpm mfa:reset <email-or-login-id>
 */
import { loadEnv } from "./_env";
import { adminClient, findUserByEmail } from "./_admin";
import { loginToAuthEmail } from "../lib/auth/login-id";

loadEnv();

async function main() {
  const login = process.argv[2];
  if (!login) {
    console.error("Usage: pnpm mfa:reset <email-or-login-id>");
    process.exit(1);
  }
  const admin = adminClient();
  const user = await findUserByEmail(admin, loginToAuthEmail(login));
  if (!user) throw new Error(`No user found for ${login}`);

  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (error) throw error;
  for (const f of data.factors) {
    const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
    if (delError) throw delError;
  }
  await admin.from("profiles").update({ mfa_enrolled_at: null }).eq("id", user.id);
  await admin.from("audit_logs").insert({
    actor_type: "system",
    action: "mfa.reset_by_operator",
    entity_type: "profile",
    entity_id: user.id,
    detail: { factors_removed: data.factors.length },
  });
  console.log(`✓ Removed ${data.factors.length} factor(s) for ${login}. They must enroll a new authenticator at next sign-in.`);
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  process.exitCode = 1;
});
