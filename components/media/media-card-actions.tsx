"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteMediaAction, renameMediaAction } from "@/app/(dashboard)/media/actions";

export function MediaCardActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="File actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`/api/media/${id}/preview`} target="_blank" rel="noreferrer">
            <Eye /> Preview
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const next = prompt("New file name", name);
            if (!next || next === name) return;
            start(async () => {
              const r = await renameMediaAction({ assetId: id, name: next });
              if (r.ok) router.refresh();
              else toast.error(r.error);
            });
          }}
        >
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            if (!confirm(`Delete "${name}"?`)) return;
            start(async () => {
              const r = await deleteMediaAction({ assetId: id });
              if (r.ok) {
                toast.success("Deleted");
                router.refresh();
              } else toast.error(r.error);
            });
          }}
        >
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
