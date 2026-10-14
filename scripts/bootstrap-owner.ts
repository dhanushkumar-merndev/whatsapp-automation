/**
 * Creates the first owner account (public sign-up stays disabled).
 *   BOOTSTRAP_OWNER_LOGIN     email or login ID (e.g. "Gayathri@2026")
 *   BOOTSTRAP_OWNER_PASSWORD  initial password (generated if empty)
 * Run:  pnpm bootstrap:owner            (add --reset-password to set the password again)
 * The owner must still enroll an authenticator app on first sign-in.
 */
import { randomBytes } from "node:crypto";
import { loadEnv, required } from "./_env";
import { adminClient, findUserByEmail } from "./_admin";
import { isEmail, loginToAuthEmail } from "../lib/auth/login-id";

loadEnv();

async function main() {
  const login = required("BOOTSTRAP_OWNER_LOGIN");
  const email = loginToAuthEmail(login);
  const loginId = isEmail(login) ? null : login.trim();
  let password = process.env.BOOTSTRAP_OWNER_PASSWORD?.trim() ?? "";
  const generated = !password;
  if (generated) password = randomBytes(18).toString("base64url");
  const resetPassword = process.argv.includes("--reset-password");

  const admin = adminClient();
  let user = await findUserByEmail(admin, email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { login_id: loginId },
    });
    if (error) throw error;
    user = data.user;
    console.log(`✓ Created auth user for ${loginId ?? email}`);
  } else {
    console.log(`• Auth user for ${loginId ?? email} already exists`);
    if (resetPassword) {
      const { error } = await admin.auth.admin.updateUserById(user.id, { password });
      if (error) throw error;
      console.log("✓ Password reset");
    }
  }

  const { data: existing } = await admin.from("profiles").select("id, status").eq("id", user.id).maybeSingle();
  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email,
    login_id: loginId,
    full_name: loginId ?? email.split("@")[0],
    role: "owner",
    status: existing?.status === "active" ? "active" : "invited",
  });
  if (profileError) throw profileError;
  await admin.from("audit_logs").insert({
    actor_type: "system",
    action: existing ? "owner.bootstrap_rerun" : "owner.bootstrapped",
    entity_type: "profile",
    entity_id: user.id,
    detail: { login: loginId ?? email },
  });

  console.log(`✓ Owner profile ready (role: owner)\n`);
  console.log(`Sign in at ${process.env.NEXT_PUBLIC_APP_URL ?? "your app URL"}/login`);
  console.log(`  Login:    ${loginId ?? email}`);
  if (generated || (!existing && !process.env.BOOTSTRAP_OWNER_PASSWORD)) console.log(`  Password: ${password}   (shown once — store it safely)`);
  else console.log("  Password: the value of BOOTSTRAP_OWNER_PASSWORD");
  console.log("\nYou will be asked to scan an authenticator QR code on first sign-in.");
  console.log("Then remove BOOTSTRAP_OWNER_PASSWORD from .env.");
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  process.exitCode = 1;
});
