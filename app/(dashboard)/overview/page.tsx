import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { requirePageSession } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const session = await requirePageSession("staff");
  return <PageHeader title="Overview" description={`Signed in as ${session.fullName ?? session.email}`} />;
}
