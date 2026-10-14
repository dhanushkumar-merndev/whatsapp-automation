"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendManualReplyAction } from "@/app/(dashboard)/conversations/actions";

export function ReplyBox({ conversationId, windowOpen, expiresLabel }: { conversationId: string; windowOpen: boolean; expiresLabel: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await sendManualReplyAction({ conversationId, text });
      if (r.ok) {
        setText("");
        router.refresh();
      } else toast.error(r.error);
    });
  if (!windowOpen) {
    return (
      <div className="rounded-3xl border bg-muted/50 p-4 text-sm text-muted-foreground">
        The 24-hour customer service window has closed. Free-form replies are blocked until the customer messages again —
        the bot never starts conversations.
      </div>
    );
  }
  return (
    <div className="rounded-3xl border bg-background p-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && text.trim()) {
            e.preventDefault();
            send();
          }
        }}
        rows={2}
        maxLength={4096}
        placeholder="Reply on WhatsApp…"
        className="min-h-12 resize-none border-0 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[11px] text-muted-foreground">Window open · {expiresLabel}</span>
        <Button size="icon-sm" onClick={send} disabled={pending || !text.trim()} aria-label="Send reply">
          {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </div>
  );
}
