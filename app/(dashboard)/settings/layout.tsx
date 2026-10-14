import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeader } from "@/components/common/page-header";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="Automation rules, team access, security and privacy." />
      <SettingsNav />
      <div className="mt-5">{children}</div>
    </>
  );
}
