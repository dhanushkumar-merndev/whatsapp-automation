/**
 * Seeds data that depends on your environment: registers the WhatsApp number
 * from META_WABA_ID / META_PHONE_NUMBER_ID. Workflows are created in the
 * dashboard (or imported from ChatGPT JSON). Safe to run repeatedly.
 *   pnpm db:seed
 */
import { loadEnv, required } from "./_env";
import { adminClient } from "./_admin";

loadEnv();

async function main() {
  const admin = adminClient();
  const wabaId = required("META_WABA_ID");
  const phoneNumberId = required("META_PHONE_NUMBER_ID");

  const { data: account } = await admin.from("whatsapp_accounts").select("id").eq("phone_number_id", phoneNumberId).maybeSingle();
  if (account) {
    console.log("• WhatsApp number already registered");
    return;
  }
  const { error } = await admin.from("whatsapp_accounts").insert({ name: "Star Growth Hub", waba_id: wabaId, phone_number_id: phoneNumberId });
  if (error) throw error;
  console.log("✓ Registered WhatsApp number (phone number ID from .env)");
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  process.exitCode = 1;
});
