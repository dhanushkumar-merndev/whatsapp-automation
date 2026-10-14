"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, PlugZap, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveAccountAction, testAccountAction } from "@/app/(dashboard)/whatsapp/actions";

export function AccountForm({ initial }: { initial?: { id: string; name: string; wabaId: string; phoneNumberId: string; enabled: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial ?? { id: null as string | null, name: "Star Growth Hub", wabaId: "", phoneNumberId: "", enabled: true });
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="outline" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> Add number
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit WhatsApp number" : "Add WhatsApp number"}</DialogTitle>
          <DialogDescription>IDs come from Meta → WhatsApp → API Setup. The access token stays on the server (META_ACCESS_TOKEN).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">WhatsApp Business Account ID</Label>
            <Input value={v.wabaId} onChange={(e) => setV({ ...v, wabaId: e.target.value.trim() })} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Phone number ID</Label>
            <Input value={v.phoneNumberId} onChange={(e) => setV({ ...v, phoneNumberId: e.target.value.trim() })} className="font-mono" />
          </div>
          <label className="flex items-center justify-between text-sm">
            Accept messages for this number
            <Switch checked={v.enabled} onCheckedChange={(c) => setV({ ...v, enabled: c })} />
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveAccountAction(v);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Saved");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TestAccountButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await testAccountAction({ id });
          if (r.ok) toast.success(`Connected: ${r.data?.verified_name ?? ""} ${r.data?.display_phone_number ?? ""}`);
          else toast.error(r.error);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <PlugZap />} Test connection
    </Button>
  );
}
