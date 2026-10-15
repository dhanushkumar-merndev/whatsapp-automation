import {
  Gauge,
  Image as ImageIcon,
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

export type NavSection = "Workspace" | "Automation" | "System";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  role: Role;
  section: NavSection;
}

export const NAV_SECTIONS: NavSection[] = ["Workspace", "Automation", "System"];

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, role: "staff", section: "Workspace" },
  { href: "/whatsapp", label: "WhatsApp Accounts", icon: Smartphone, role: "admin", section: "Automation" },
  { href: "/flows", label: "Workflows", icon: Workflow, role: "admin", section: "Automation" },
  { href: "/leads", label: "Leads", icon: UsersRound, role: "staff", section: "Workspace" },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare, role: "staff", section: "Workspace" },
  { href: "/media", label: "Media Library", icon: ImageIcon, role: "admin", section: "Automation" },
  { href: "/crm", label: "CRM Integrations", icon: Plug, role: "admin", section: "System" },
  { href: "/usage", label: "Usage", icon: Gauge, role: "admin", section: "System" },
  { href: "/logs", label: "Execution Logs", icon: ScrollText, role: "admin", section: "System" },
  { href: "/settings", label: "Settings", icon: Settings, role: "admin", section: "System" },
];
