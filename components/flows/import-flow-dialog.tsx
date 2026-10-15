"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { CircleAlert, CircleX, FileJson, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/common/copy-button";
import { ReadonlyFlowClient } from "@/components/builder/readonly-flow-client";
import { importFlowAction } from "@/app/(dashboard)/flows/actions";
import { fixRequestText, importFlowJson } from "@/lib/flows/import";

type Props =
  | { mode: "create"; trigger?: React.ReactNode }
  | { mode: "replace"; flowId: string; open: boolean; onOpenChange: (o: boolean) => void; onReplaced: () => void };

/** Paste workflow JSON (e.g. from ChatGPT): checked live, previewed, then created as a draft. */
export function ImportFlowDialog(props: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.mode === "replace" ? props.open : ownOpen;
  const setOpen = props.mode === "replace" ? props.onOpenChange : setOwnOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.mode === "create" && (
        <DialogTrigger asChild>
          {props.trigger ?? (
            <Button variant="outline">
              <FileJson /> Import JSON
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {open && <ImportBody {...props} close={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportBody(props: Props & { close: () => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const deferred = useDeferredValue(text);
  const result = useMemo(() => (deferred.trim() ? importFlowJson(deferred) : null), [deferred]);
  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = result?.issues.filter((i) => i.level === "warning") ?? [];
  const replace = props.mode === "replace";

  const submit = () =>
    start(async () => {
      const r = await importFlowAction({ json: text, flowId: replace ? props.flowId : null, name });
      if (r && !r.ok) {
        toast.error(r.error);
        return;
      }
      if (replace) {
        toast.success("Draft replaced from JSON");
        props.close();
        props.onReplaced();
      }
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{replace ? "Replace this workflow from JSON" : "Import a workflow from JSON"}</DialogTitle>
        <DialogDescription>
          Paste the JSON ChatGPT gave you (the whole reply is fine). It is saved as a draft — test it, then publish to go live.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={'{\n  "name": "Website enquiry",\n  "steps": [ … ]\n}'}
          className="font-mono text-xs"
          autoFocus
        />

        {result && result.errors.length > 0 && (
          <div className="space-y-1 rounded-2xl border border-destructive/30 bg-destructive/10 p-3">
            <div className="text-sm font-medium text-destructive">This JSON can’t be imported yet</div>
            {result.errors.map((e, i) => (
              <p key={i} className="flex gap-1.5 text-xs text-destructive">
                <CircleX className="mt-0.5 size-3 shrink-0" /> {e}
              </p>
            ))}
          </div>
        )}

        {result?.definition && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{result.name ?? "Untitled workflow"}</span>
              <span className="text-muted-foreground">{result.definition.nodes.length} steps</span>
              {errors.length > 0 && <span className="text-destructive">{errors.length} to fix before publishing</span>}
              {warnings.length > 0 && <span className="text-warning">{warnings.length} warning(s)</span>}
            </div>
            {result.issues.length > 0 && (
              <details className="rounded-2xl border p-3">
                <summary className="cursor-pointer text-sm font-medium">Problems found</summary>
                <ul className="mt-2 space-y-1">
                  {result.issues.map((i, n) => (
                    <li key={n} className={`flex gap-1.5 text-xs ${i.level === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                      <CircleAlert className="mt-0.5 size-3 shrink-0" /> {i.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <ReadonlyFlowClient definition={result.definition} visited={result.definition.nodes.map((n) => n.id)} current={null} height={320} />
            {!replace && (
              <div className="space-y-1.5">
                <Label htmlFor="import-name">Name (optional)</Label>
                <Input id="import-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={result.name ?? "Imported workflow"} maxLength={120} />
              </div>
            )}
          </>
        )}

        {result && (result.errors.length > 0 || result.issues.length > 0) && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 p-3 text-xs text-muted-foreground">
            <span>Paste this into ChatGPT and it will send back corrected JSON.</span>
            <CopyButton value={fixRequestText(result)} label="Copy fix request" />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={props.close}>
          Cancel
        </Button>
        <Button disabled={!result?.definition || pending} onClick={submit}>
          {pending && <Loader2 className="animate-spin" />}
          {replace ? "Replace draft" : "Create workflow"}
        </Button>
      </DialogFooter>
    </>
  );
}
