"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, CircleSlash, Headset, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setConversationStatusAction } from "@/app/(dashboard)/conversations/actions";
import type { ChatAction } from "@/lib/core/conversation-control";

/** Take over, hand back to the bot (optionally restarting the flow now), or close — like the Telegram buttons. */
export function StatusControls({ conversationId, status }: { conversationId: string; status: "open" | "handoff" | "closed" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: ChatAction) =>
    start(async () => {
      const r = await setConversationStatusAction({ conversationId, action });
      if (r.ok) toast.success(r.data ?? "Done");
      else toast.error(r.error);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "handoff" && (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run("human")}>
          <Headset /> Take over (pause bot)
        </Button>
      )}
      {status !== "open" && (
        <>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run("bot_on")}>
            <Bot /> Bot on
          </Button>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run("restart")}>
            <RotateCcw /> Restart flow now
          </Button>
        </>
      )}
      {status !== "closed" && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run("close")}>
          <CircleSlash /> Close
        </Button>
      )}
    </div>
  );
}
