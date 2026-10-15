"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setFlowStatusAction } from "@/app/(dashboard)/flows/actions";

/** "Live" marker for the live workflow; "Make live" for any other published one. */
export function FlowLiveButton({ id, status, published }: { id: string; status: string; published: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background">
        <span className="size-1.5 rounded-full bg-success" /> Live
      </span>
    );
  }
  if (status === "archived") return null;
  const button = (
    <Button
      size="xs"
      variant="outline"
      disabled={!published || pending}
      onClick={() =>
        start(async () => {
          const r = await setFlowStatusAction({ flowId: id, status: "active" });
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Now live. The previous live workflow was paused; its open chats can finish.");
            router.refresh();
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Radio />} Make live
    </Button>
  );
  if (published) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>Publish it first (open it and press Publish).</TooltipContent>
    </Tooltip>
  );
}
