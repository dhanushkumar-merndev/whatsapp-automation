"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CopyButton } from "@/components/common/copy-button";
import { getAiPromptAction } from "@/app/(dashboard)/flows/actions";
import { ImportFlowDialog } from "./import-flow-dialog";

/** Three steps: copy the prompt, describe the workflow to ChatGPT, import the JSON it returns. */
export function AiPromptDialog() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await getAiPromptAction();
      if (r.ok && r.data) setPrompt(r.data);
      else toast.error(r.ok ? "Could not build the prompt" : r.error);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !prompt) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles /> Build with ChatGPT
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Build a workflow with ChatGPT</DialogTitle>
          <DialogDescription>ChatGPT writes the workflow; this app checks it and turns it into steps you can edit.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-4 text-sm">
          <li className="space-y-2">
            <div className="font-medium">1. Copy the prompt</div>
            <div className="flex flex-wrap items-center gap-2">
              {pending || !prompt ? (
                <Button size="sm" disabled>
                  <Loader2 className="animate-spin" /> Preparing…
                </Button>
              ) : (
                <CopyButton value={prompt} label="Copy prompt" className="h-8 rounded-full border px-3" />
              )}
              <span className="text-xs text-muted-foreground">It lists every step type, your media files and CRM integrations.</span>
            </div>
            {prompt && (
              <details className="rounded-2xl border p-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">Show prompt</summary>
                <pre className="mt-2 max-h-64 overflow-auto text-[11px] whitespace-pre-wrap">{prompt}</pre>
              </details>
            )}
          </li>
          <li className="space-y-1">
            <div className="font-medium">2. Paste it into ChatGPT, then describe your workflow</div>
            <p className="text-xs text-muted-foreground">
              For example: “Greet the customer, send our brochure, ask name, ask which service (Website, Ads, Branding), ask budget, save the
              lead and tell them we’ll call within an hour.”
            </p>
            <Button variant="ghost" size="sm" asChild>
              <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">
                <ExternalLink /> Open ChatGPT
              </a>
            </Button>
          </li>
          <li className="space-y-2">
            <div className="font-medium">3. Copy ChatGPT’s JSON and import it</div>
            <ImportFlowDialog mode="create" />
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}
