"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { roleAllows, type Role } from "@/lib/auth/steps";
import { Logo } from "@/components/brand/logo";
import { NAV_ITEMS, NAV_SECTIONS } from "./nav";
import { NotificationsMenu, type NotificationItem } from "./notifications-menu";
import { UserMenu } from "./user-menu";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => roleAllows(role, i.role));
  return (
    <nav className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section) => {
        const sectionItems = items.filter((i) => i.section === section);
        if (sectionItems.length === 0) return null;
        return (
          <div key={section} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 text-sm text-muted-foreground">{section}</div>
            {sectionItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                    active && "bg-sidebar-accent font-medium",
                  )}
                >
                  <Icon className={cn("size-[18px]", active ? "text-foreground" : "text-foreground/70")} strokeWidth={1.75} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarFooter({ name, role }: { name: string; role: Role }) {
  return (
    <div className="border-t border-sidebar-border px-2.5 py-2">
      <UserMenu name={name} role={role} />
    </div>
  );
}

export function Sidebar({
  role,
  name,
  notifications,
}: {
  role: Role;
  name: string;
  notifications: { items: NotificationItem[]; unread: number };
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="mx-2.5 mt-3 mb-4 flex items-center justify-between pl-2.5">
        <Logo />
        <NotificationsMenu {...notifications} align="start" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <SidebarNav role={role} />
      </div>
      <SidebarFooter name={name} role={role} />
    </aside>
  );
}
