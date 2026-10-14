"use client";

import { useState, useTransition } from "react";
import { Building2, Loader2, Plus, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFlowAction, type FlowTemplate } from "@/app/(dashboard)/flows/actions";
import { cn } from "@/lib/utils";

export function NewFlowDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<FlowTemplate>("star_growth_hub");
  const [pending, start] = useTransition();
  const create = () =>
    start(async () => {
      const r = await createFlowAction({ name, template });
      if (r && !r.ok) toast.error(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New flow
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a flow</DialogTitle>
          <DialogDescription>Flows always start when a customer messages you first.</DialogDescription>
        </DialogHeader>
        <form
          id="new-flow"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="flow-name">Name</Label>
            <Input id="flow-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website enquiry (optional)" maxLength={120} autoFocus />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { id: "star_growth_hub", title: "Star Growth Hub enquiry", desc: "Welcome + brochure, name, service, business, requirements, lead + CRM.", Icon: Sparkles },
                {
                  id: "real_estate_ads",
                  title: "Real estate ad questions",
                  desc: "Answers the 4 Facebook ad questions after 5 sec, offers a call, collects name + business on Yes.",
                  Icon: Building2,
                },
                { id: "blank", title: "Blank flow", desc: "Start with just the customer-message trigger.", Icon: Square },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t.id)}
                aria-pressed={template === t.id}
                className={cn("rounded-2xl border p-4 text-left transition-colors", template === t.id ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/60")}
              >
                <t.Icon className="mb-2 size-4" />
                <div className="text-sm font-medium">{t.title}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.desc}</p>
              </button>
            ))}
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="new-flow" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Create flow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
