"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleX, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { previewPublishAction, publishFlowAction } from "@/app/(dashboard)/flows/actions";
import type { FlowDefinition } from "@/lib/engine/schema";
import type { GraphValidation } from "@/lib/engine/validate-graph";

type PublishDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  flowId: string;
  flowName: string;
  definition: FlowDefinition;
  hasTestNumbers: boolean;
  onPublished: () => void;
};

export function PublishDialog(props: PublishDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {/* Mounted fresh on every open, so each publish is checked again on the server. */}
        {props.open && <PublishBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function PublishBody({ onOpenChange, flowId, flowName, definition, hasTestNumbers, onPublished }: PublishDialogProps) {
  const [loading, setLoading] = useState(true);
  const [validation, setValidation] = useState<GraphValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"active" | "testing">("active");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [request] = useState(() => ({ definition }));

  useEffect(() => {
    let cancelled = false;
    previewPublishAction(request)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.data) setValidation(r.data);
        else setError(r.ok ? "Could not check the workflow" : r.error);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [request]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Rocket className="size-4" /> Publish “{flowName}”
        </DialogTitle>
        <DialogDescription>Publishing saves a new version. Only one workflow is live at a time.</DialogDescription>
      </DialogHeader>

      {loading && (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Checking the workflow…
        </div>
      )}
      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {validation && (
        <div className="space-y-4">
          {!validation.ok && (
            <div className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
              <div className="text-sm font-medium text-destructive">Fix these errors before publishing</div>
              {validation.errors.map((e, i) => (
                <p key={i} className="flex gap-1.5 text-xs text-destructive">
                  <CircleX className="mt-0.5 size-3 shrink-0" /> {e.message}
                </p>
              ))}
            </div>
          )}

          {validation.warnings.length > 0 && (
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">{validation.warnings.length} warning(s)</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {validation.warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="space-y-2">
            <Label className="text-xs">Publish to</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "active" | "testing")} className="gap-2">
              <label className="flex items-start gap-2 rounded-xl border p-2.5 text-sm">
                <RadioGroupItem value="active" className="mt-0.5" />
                <span>
                  <span className="font-medium">Live for all customers</span>
                  <span className="block text-xs text-muted-foreground">
                    Replaces the current live workflow. Customers already in the middle of it can finish.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-xl border p-2.5 text-sm">
                <RadioGroupItem value="testing" className="mt-0.5" />
                <span>
                  <span className="font-medium">Test numbers only</span>
                  <span className="block text-xs text-muted-foreground">
                    Runs only for your test numbers (Settings → Live testing).
                    {!hasTestNumbers && " No test numbers are configured yet."}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Version note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What changed?" />
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          disabled={!validation?.ok || pending}
          onClick={() =>
            start(async () => {
              const res = await publishFlowAction({ flowId, definition, mode, note });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success(`Published version ${res.data?.version}${mode === "testing" ? " for test numbers" : " — now live"}`);
              onOpenChange(false);
              onPublished();
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          Publish
        </Button>
      </DialogFooter>
    </>
  );
}
