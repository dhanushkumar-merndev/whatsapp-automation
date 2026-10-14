"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateSettingsAction } from "@/app/(dashboard)/settings/actions";

export function HardCapForm({ initial }: { initial: { hardCapEnabled: boolean; qstashDailyBudget: number; redisCommandsPerCheck: number; qstashRetries: number } }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="text-sm font-medium">Hard usage cap</span>
          <span className="block text-xs text-muted-foreground">
            When today&apos;s QStash usage reaches the budget, non-essential delays are skipped and CRM retries are deferred to the daily sweep.
            Inbound messages are always recorded and leads are never dropped.
          </span>
        </span>
        <Switch checked={v.hardCapEnabled} onCheckedChange={(c) => setV({ ...v, hardCapEnabled: c })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Internal QStash budget / day</Label>
          <Input type="number" min={0} value={v.qstashDailyBudget} onChange={(e) => setV({ ...v, qstashDailyBudget: Number(e.target.value) || 0 })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">QStash retries per delivery</Label>
          <Input type="number" min={0} max={5} value={v.qstashRetries} onChange={(e) => setV({ ...v, qstashRetries: Number(e.target.value) || 0 })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Redis commands per rate-limit check (estimate)</Label>
          <Input type="number" min={0} step={0.5} value={v.redisCommandsPerCheck} onChange={(e) => setV({ ...v, redisCommandsPerCheck: Number(e.target.value) || 0 })} />
        </div>
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await updateSettingsAction({ usage: v });
            if (r.ok) {
              toast.success("Usage settings saved");
              router.refresh();
            } else toast.error(r.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />} Save
      </Button>
    </div>
  );
}
