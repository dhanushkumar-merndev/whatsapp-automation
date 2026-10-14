"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteLeadAction, retryCrmAction, updateLeadAction } from "@/app/(dashboard)/leads/actions";

const STATUSES = ["incomplete", "new", "qualified", "contacted", "won", "lost", "closed"];

export function LeadEditor({
  lead,
  staff,
  canAdmin,
}: {
  lead: { id: string; status: string; assigned_to: string | null; notes: string | null; crm_sync_status: string };
  staff: { id: string; name: string }[];
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(lead.status);
  const [assigned, setAssigned] = useState(lead.assigned_to ?? "");
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Assigned to</Label>
          <Select value={assigned || "__none"} onValueChange={(v) => setAssigned(v === "__none" ? "" : v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Unassigned</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={5000} placeholder="Internal notes (not sent to the customer)" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateLeadAction({ leadId: lead.id, status, assignedTo: assigned || null, notes });
              if (r.ok) {
                toast.success("Lead updated");
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
        {canAdmin && lead.status !== "incomplete" && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await retryCrmAction({ leadId: lead.id });
                if (r.ok) {
                  toast.success((r.data ?? []).join(" · ") || "Retried");
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            <RefreshCw /> {lead.crm_sync_status === "synced" ? "Re-send to CRM" : "Retry CRM sync"}
          </Button>
        )}
        {canAdmin && (
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => {
              if (!confirm("Delete this lead permanently? The conversation history is kept.")) return;
              start(async () => {
                const r = await deleteLeadAction({ leadId: lead.id });
                if (r.ok) router.push("/leads");
                else toast.error(r.error);
              });
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}
