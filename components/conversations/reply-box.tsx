"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Ban, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendManualReplyAction } from "@/app/(dashboard)/conversations/actions";

export function ReplyBox({
  conversationId,
  windowOpen,
  optedOut = false,
  expiresLabel,
}: {
  conversationId: string;
  windowOpen: boolean;
  optedOut?: boolean;
  expiresLabel: string;
}) {
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
    const Icon = optedOut ? Ban : Clock;
    return (
      <div className="flex items-start gap-3 rounded-3xl border bg-muted/50 p-4 text-sm">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <div>
          <div className="font-medium">{optedOut ? "This customer has opted out" : "Reply window closed"}</div>
          <p className="mt-0.5 text-muted-foreground">
            {optedOut
              ? "They asked to stop messages. Nothing can be sent until they opt back in (for example by sending START)."
              : "WhatsApp only allows free-form replies within 24 hours of the customer's last message. You can reply again as soon as they write back."}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-3xl border bg-background p-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-transparent dark:bg-accent">
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
        className="min-h-12 resize-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
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
