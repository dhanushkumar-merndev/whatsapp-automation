"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { roleAllows, type Role } from "@/lib/auth/steps";
import { Logo } from "@/components/brand/logo";
import { NAV_ITEMS } from "./nav";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.filter((i) => roleAllows(role, i.role)).map((item) => {
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
    </nav>
  );
}

export function Sidebar({ role }: { role: Role }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col bg-sidebar px-2.5 py-3 lg:flex">
      <Logo className="mb-5 px-2.5 py-1.5" />
      <SidebarNav role={role} />
    </aside>
  );
}
