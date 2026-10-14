import { Sidebar } from "@/components/dashboard/sidebar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { NotificationsMenu, type NotificationItem } from "@/components/dashboard/notifications-menu";
import { UserMenu } from "@/components/dashboard/user-menu";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

// Authenticated, per-request pages: never prerendered or cached.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Redirects to /login, /mfa/enroll or /mfa/verify unless the session is MFA-verified (aal2).
  const session = await requirePageSession("staff");
  const supabase = await createClient();
  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, severity, title, body, link, created_at")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(15),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);

  const displayName = session.fullName || session.loginId || session.email;
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={session.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-1.5 bg-background/95 px-3 backdrop-blur lg:px-5">
          <MobileNav role={session.role} />
          <div className="flex-1" />
          <NotificationsMenu items={(items ?? []) as NotificationItem[]} unread={count ?? 0} />
          <UserMenu name={displayName} role={session.role} />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-2 pb-10 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
