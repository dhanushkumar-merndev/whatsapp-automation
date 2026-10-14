import type { Metadata } from "next";
import { GeneralSettingsForm } from "@/components/settings/general-form";
import { requirePageSession } from "@/lib/auth/guard";
import { loadSettings } from "@/lib/settings/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePageSession("admin");
  const settings = await loadSettings();
  return <GeneralSettingsForm initial={settings} telegramTokenSet={Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())} />;
}
