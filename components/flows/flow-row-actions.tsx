"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Copy, FlaskConical, MoreHorizontal, Pause, Pencil, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { duplicateFlowAction, setFlowStatusAction } from "@/app/(dashboard)/flows/actions";

export function FlowRowActions({ id, status, published }: { id: string; status: string; published: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const setStatus = (s: "active" | "testing" | "paused" | "archived") =>
    start(async () => {
      if (s === "archived" && !confirm("Archive this flow?")) return;
      const r = await setFlowStatusAction({ flowId: id, status: s });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(`Flow ${s}`);
        router.refresh();
      }
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="Flow actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/flows/${id}`}>
            <Pencil /> Open in builder
          </Link>
        </DropdownMenuItem>
        {status !== "active" && published && (
          <DropdownMenuItem onSelect={() => setStatus("active")}>
            <Play /> Activate
          </DropdownMenuItem>
        )}
        {status !== "testing" && published && (
          <DropdownMenuItem onSelect={() => setStatus("testing")}>
            <FlaskConical /> Test numbers only
          </DropdownMenuItem>
        )}
        {(status === "active" || status === "testing") && (
          <DropdownMenuItem onSelect={() => setStatus("paused")}>
            <Pause /> Pause
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => start(async () => void (await duplicateFlowAction({ flowId: id })))}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        {status !== "archived" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setStatus("archived")}>
              <Archive /> Archive
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
