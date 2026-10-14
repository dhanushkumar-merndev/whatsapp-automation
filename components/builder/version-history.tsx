"use client";

import { useTransition } from "react";
import { History, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useConfirm } from "@/components/common/confirm-dialog";
import { rollbackFlowAction, restoreVersionToDraftAction } from "@/app/(dashboard)/flows/actions";
import { fmtDate } from "@/lib/format";
import { LevelPill } from "./usage-report";
import type { WarningLevel } from "@/lib/estimator/estimate";

export interface VersionItem {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  publishedBy: string | null;
  level: WarningLevel | null;
}

export function VersionHistory({
  flowId,
  versions,
  liveVersionId,
  dirty,
  onDraftReplaced,
}: {
  flowId: string;
  versions: VersionItem[];
  liveVersionId: string | null;
  dirty: boolean;
  onDraftReplaced: () => void;
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Failed");
      else {
        toast.success(success);
        onDraftReplaced();
      }
    });

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Version history" className="max-xl:size-8 max-xl:px-0">
          <History /> <span className="max-xl:sr-only">Versions</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>
            Published versions are immutable. Running conversations keep the version they started with.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-2 overflow-y-auto px-4 pb-4">
          {versions.length === 0 && <p className="text-sm text-muted-foreground">Not published yet.</p>}
          {versions.map((v) => {
            const live = v.id === liveVersionId;
            return (
              <div key={v.id} className="rounded-2xl border p-3.5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">
                    Version {v.version} {live && <span className="ml-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">Live</span>}
                  </div>
                  {v.level && <LevelPill level={v.level} />}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtDate(v.createdAt)}
                  {v.publishedBy && ` · ${v.publishedBy}`}
                </div>
                {v.note && <p className="mt-1 text-xs">{v.note}</p>}
                <div className="mt-2 flex gap-2">
                  {!live && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={pending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Make version ${v.version} live?`,
                          description: "New conversations will use it immediately. Conversations already running keep their version.",
                          confirmLabel: "Make live",
                        });
                        if (ok) run(() => rollbackFlowAction({ flowId, versionId: v.id }), `Version ${v.version} is live again`);
                      }}
                    >
                      <Undo2 /> Roll back to this
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Load version ${v.version} into the draft?`,
                        description: dirty
                          ? "This replaces your current draft, including changes that haven't saved yet. The live version doesn't change."
                          : "This replaces your current draft. The live version doesn't change until you publish.",
                        confirmLabel: "Load version",
                        destructive: dirty,
                      });
                      if (ok) run(() => restoreVersionToDraftAction({ flowId, versionId: v.id }), `Version ${v.version} loaded into the draft`);
                    }}
                  >
                    <Upload /> Load into draft
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
