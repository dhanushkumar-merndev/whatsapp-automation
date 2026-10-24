"use client";

import { usePathname } from "next/navigation";
import { SegmentedNav } from "@/components/common/segmented-nav";

const ITEMS = [
  { href: "/settings", label: "General" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/data", label: "Data" },
  { href: "/settings/audit", label: "Audit log" },
];

export function SettingsNav() {
  const path = usePathname();
  return <SegmentedNav items={ITEMS.map((i) => ({ ...i, active: path === i.href }))} />;
}
