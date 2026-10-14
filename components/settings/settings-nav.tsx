"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings", label: "General" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/security", label: "Security & MFA" },
  { href: "/settings/audit", label: "Audit log" },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <div className="inline-flex flex-wrap rounded-full bg-muted p-1">
      {ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cn("rounded-full px-3.5 py-1.5 text-xs font-medium", path === i.href ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
