"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, CircleSlash, Headset } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setConversationStatusAction } from "@/app/(dashboard)/conversations/actions";

export function StatusControls({ conversationId, status }: { conversationId: string; status: "open" | "handoff" | "closed" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (s: "open" | "handoff" | "closed", msg: string) =>
    start(async () => {
      const r = await setConversationStatusAction({ conversationId, status: s });
      if (r.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "handoff" && (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => set("handoff", "You have taken over this conversation")}>
          <Headset /> Take over (stop bot)
        </Button>
      )}
      {status !== "open" && (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => set("open", "Automation resumes on the customer's next message")}>
          <Bot /> Resume automation
        </Button>
      )}
      {status !== "closed" && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => set("closed", "Conversation closed")}>
          <CircleSlash /> Close
        </Button>
      )}
    </div>
  );
}
