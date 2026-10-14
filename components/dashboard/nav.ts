import {
  Image as ImageIcon,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  ScrollText,
  Settings,
  Smartphone,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth/steps";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  role: Role;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, role: "staff" },
  { href: "/whatsapp", label: "WhatsApp Accounts", icon: Smartphone, role: "admin" },
  { href: "/builder", label: "Flow Builder", icon: Workflow, role: "admin" },
  { href: "/flows", label: "My Flows", icon: FolderOpen, role: "admin" },
  { href: "/leads", label: "Leads", icon: UsersRound, role: "staff" },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare, role: "staff" },
  { href: "/media", label: "Media Library", icon: ImageIcon, role: "admin" },
  { href: "/crm", label: "CRM Integrations", icon: Plug, role: "admin" },
  { href: "/usage", label: "Usage & Limits", icon: Gauge, role: "admin" },
  { href: "/logs", label: "Execution Logs", icon: ScrollText, role: "admin" },
  { href: "/settings", label: "Settings", icon: Settings, role: "admin" },
];
