"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/common/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deletePlanLimitAction, savePlanLimitAction } from "@/app/(dashboard)/settings/actions";

export interface PlanLimitItem {
  id: string | null;
  service: "qstash" | "redis" | "supabase" | "meta_whatsapp" | "vercel";
  metric: string;
  period: "day" | "month" | "total" | "per_message";
  limit_value: number | null;
  unit: string | null;
  unit_price: number | null;
  currency: string | null;
  category: string | null;
  country_code: string | null;
  phone_number_id: string | null;
  plan_name: string | null;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  active: boolean;
}

const NEW: PlanLimitItem = {
  id: null,
  service: "meta_whatsapp",
  metric: "service_message",
  period: "per_message",
  limit_value: null,
  unit: "message",
  unit_price: 0,
  currency: "USD",
  category: "service",
  country_code: "IN",
  phone_number_id: null,
  plan_name: null,
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: null,
  notes: null,
  active: true,
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function PlanLimitDialog({ item }: { item?: PlanLimitItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<PlanLimitItem>(item ?? NEW);
  const [pending, start] = useTransition();
  const set = (p: Partial<PlanLimitItem>) => setV({ ...v, ...p });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {item ? (
          <Button variant="ghost" size="icon-sm" aria-label="Edit limit">
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus /> Add allowance / rate card
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit allowance" : "Add allowance or rate card"}</DialogTitle>
          <DialogDescription>Manually configured values are labelled as such everywhere. Use a new effective date when pricing changes.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Service</Label>
            <Select value={v.service} onValueChange={(s) => set({ service: s as PlanLimitItem["service"] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["qstash", "redis", "supabase", "meta_whatsapp", "vercel"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Metric</Label>
            <Input value={v.metric} onChange={(e) => set({ metric: e.target.value })} className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Period</Label>
            <Select value={v.period} onValueChange={(p) => set({ period: p as PlanLimitItem["period"] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["day", "month", "total", "per_message"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Allowance / free amount</Label>
            <Input type="number" value={v.limit_value ?? ""} onChange={(e) => set({ limit_value: num(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unit price</Label>
            <Input type="number" step="0.0001" value={v.unit_price ?? ""} onChange={(e) => set({ unit_price: num(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Currency</Label>
            <Input value={v.currency ?? ""} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() || null })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category (Meta)</Label>
            <Input value={v.category ?? ""} onChange={(e) => set({ category: e.target.value || null })} placeholder="service / utility / marketing" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Country (Meta, * = all)</Label>
            <Input value={v.country_code ?? ""} maxLength={4} onChange={(e) => set({ country_code: e.target.value.toUpperCase() || null })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone number ID (optional)</Label>
            <Input value={v.phone_number_id ?? ""} onChange={(e) => set({ phone_number_id: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Plan name</Label>
            <Input value={v.plan_name ?? ""} onChange={(e) => set({ plan_name: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Effective from</Label>
            <Input type="date" value={v.effective_from} onChange={(e) => set({ effective_from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Effective to (optional)</Label>
            <Input type="date" value={v.effective_to ?? ""} onChange={(e) => set({ effective_to: e.target.value || null })} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value || null })} rows={2} />
          </div>
          <label className="col-span-2 flex items-center justify-between text-sm">
            Active
            <Switch checked={v.active} onCheckedChange={(a) => set({ active: a })} />
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await savePlanLimitAction(v);
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

export function DeletePlanLimitButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Delete limit"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ title: "Delete this allowance?", description: "Usage meters stop comparing against it.", confirmLabel: "Delete", destructive: true }))) return;
        start(async () => {
          const r = await deletePlanLimitAction({ id });
          if (!r.ok) toast.error(r.error);
          router.refresh();
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}
