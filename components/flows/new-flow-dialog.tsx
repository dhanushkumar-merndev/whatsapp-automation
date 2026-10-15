"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFlowAction } from "@/app/(dashboard)/flows/actions";

export function NewFlowDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const create = () =>
    start(async () => {
      const r = await createFlowAction({ name });
      if (r && !r.ok) toast.error(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New workflow
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a workflow</DialogTitle>
          <DialogDescription>Starts empty with the customer-message step. To build one with ChatGPT, use Import JSON instead.</DialogDescription>
        </DialogHeader>
        <form
          id="new-flow"
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Label htmlFor="flow-name">Name</Label>
          <Input id="flow-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website enquiry" maxLength={120} autoFocus />
        </form>
        <DialogFooter>
          <Button type="submit" form="new-flow" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Create workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
