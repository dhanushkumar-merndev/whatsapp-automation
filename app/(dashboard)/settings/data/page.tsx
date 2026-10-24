import type { Metadata } from "next";
import { DataBackup } from "@/components/settings/data-backup";
import { requirePageSession } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Data" };

export default async function DataPage() {
  await requirePageSession("owner");
  return <DataBackup />;
}
