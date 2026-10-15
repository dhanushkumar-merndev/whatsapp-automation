"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/common/confirm-dialog";
import { deleteMediaAction, renameMediaAction } from "@/app/(dashboard)/media/actions";

export function MediaCardActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);

  const rename = () => {
    const next = draft.trim();
    if (!next || next === name) return setRenaming(false);
    start(async () => {
      const r = await renameMediaAction({ assetId: id, name: next });
      if (r.ok) {
        setRenaming(false);
        router.refresh();
      } else toast.error(r.error);
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="File actions">
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
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
              setDraft(name);
              setRenaming(true);
            }}
          >
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={async () => {
              const ok = await confirm({
                title: `Delete “${name}”?`,
                description: "Flows that send this file will skip that step until you choose another file.",
                confirmLabel: "Delete",
                destructive: true,
              });
              if (!ok) return;
              start(async () => {
                const r = await deleteMediaAction({ assetId: id });
                if (r.ok) {
                  toast.success("File deleted");
                  router.refresh();
                } else toast.error(r.error);
              });
            }}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>This name is shown in the workflow editor. Customers see the file name set on the Send media step.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} autoFocus aria-label="File name" />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !draft.trim()}>
                {pending && <Loader2 className="animate-spin" />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
