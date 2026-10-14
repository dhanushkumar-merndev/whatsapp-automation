import {
  CircleHelp,
  FileText,
  Flag,
  GitBranch,
  Headset,
  ListChecks,
  MessageCircle,
  MessageSquareText,
  ShieldCheck,
  Timer,
  UserPlus,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { NodeType } from "@/lib/engine/schema";

export const NODE_ICONS: Record<NodeType, LucideIcon> = {
  trigger: MessageCircle,
  send_message: MessageSquareText,
  send_media: FileText,
  wait: Timer,
  ask_question: CircleHelp,
  interactive: ListChecks,
  validation: ShieldCheck,
  condition: GitBranch,
  save_lead: UserPlus,
  crm_webhook: Webhook,
  handoff: Headset,
  end: Flag,
};
