"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleX, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { previewPublishAction, publishFlowAction } from "@/app/(dashboard)/flows/actions";
import type { EstimateReport, EstimatorAssumptions } from "@/lib/estimator/estimate";
import type { FlowDefinition } from "@/lib/engine/schema";
import type { GraphValidation } from "@/lib/engine/validate-graph";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { LevelPill, UsageReportView } from "./usage-report";

type PublishDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  flowId: string;
  flowName: string;
  definition: FlowDefinition;
  assumptions: EstimatorAssumptions;
  hasTestNumbers: boolean;
  onPublished: () => void;
};

export function PublishDialog(props: PublishDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted fresh on every open, so each publish starts with a new server report. */}
        {props.open && <PublishBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function PublishBody({ onOpenChange, flowId, flowName, definition, assumptions, hasTestNumbers, onPublished }: PublishDialogProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ validation: GraphValidation; report: EstimateReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"active" | "testing">("active");
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, start] = useTransition();
  const [request] = useState(() => ({ flowId, definition, assumptions }));

  useEffect(() => {
    let cancelled = false;
    previewPublishAction(request)
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.data) setData(r.data);
        else setError(r.ok ? "No report" : r.error);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [request]);

  const r = data?.report;
  const blocked = !data || !data.validation.ok;
  const needsAck = r ? r.overallLevel !== "normal" : false;
  const qstash = r?.quotas.find((q) => q.key === "qstash_daily");

  return (
    <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-4" /> Publish “{flowName}”
          </DialogTitle>
          <DialogDescription>Review the usage report before publishing. Calculated on the server with your configured plan limits.</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Calculating usage report…
          </div>
        )}
        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {data && r && (
          <div className="space-y-4">
            {!data.validation.ok && (
              <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3">
                <div className="text-sm font-medium text-red-700">Fix these errors before publishing</div>
                {data.validation.errors.map((e, i) => (
                  <p key={i} className="flex gap-1.5 text-xs text-red-700">
                    <CircleX className="mt-0.5 size-3 shrink-0" /> {e.message}
                  </p>
                ))}
              </div>
            )}

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {[
                    ["Flow", r.flowName],
                    ["Estimated customers / day", fmtNumber(r.assumptions.customersPerDay)],
                    ["Estimated WhatsApp replies / day", fmtNumber(r.daily.whatsappReplies)],
                    ["Estimated QStash deliveries / day", fmtNumber(r.daily.qstashDeliveries, 1)],
                    ["Worst-case scheduled deliveries / day", fmtNumber(r.peakDay.qstashWorst)],
                    [
                      "Configured free-tier availability",
                      qstash?.limit != null
                        ? `${fmtNumber(Math.max(0, qstash.limit - qstash.sharedWithOtherFlows))} QStash deliveries/day available to this flow`
                        : "No QStash allowance configured",
                    ],
                    [
                      "Expected monthly Meta charges",
                      r.meta.estimatedCost === null ? "Unavailable (no rate card)" : `${fmtMoney(r.meta.estimatedCost, r.meta.currency ?? "USD")} (manually configured rate)`,
                    ],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="w-1/2 bg-muted/40 px-3 py-1.5 text-muted-foreground">{k}</td>
                      <td className="px-3 py-1.5 tabular-nums">{v}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="bg-muted/40 px-3 py-1.5 text-muted-foreground">Warning level</td>
                    <td className="px-3 py-1.5">
                      <LevelPill level={r.overallLevel} />
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-muted/40 px-3 py-1.5 align-top text-muted-foreground">Recommendation</td>
                    <td className="px-3 py-1.5">{r.recommendation}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Full usage report</summary>
              <div className="mt-3">
                <UsageReportView report={r} />
              </div>
            </details>

            {data.validation.warnings.length > 0 && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">{data.validation.warnings.length} flow warning(s)</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {data.validation.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Publish to</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as "active" | "testing")} className="gap-2">
                <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                  <RadioGroupItem value="active" className="mt-0.5" />
                  <span>
                    <span className="font-medium">All customers</span>
                    <span className="block text-xs text-muted-foreground">Starts for any customer who messages your number.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                  <RadioGroupItem value="testing" className="mt-0.5" />
                  <span>
                    <span className="font-medium">Live test numbers only</span>
                    <span className="block text-xs text-muted-foreground">
                      Runs through the real Meta API only for authorised test numbers (Settings → Live testing).
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
            {needsAck && (
              <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
                I have reviewed the usage warnings and want to publish anyway.
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={blocked || pending || (needsAck && !ack)}
            onClick={() =>
              start(async () => {
                const res = await publishFlowAction({ flowId, definition, assumptions, mode, note, acknowledgeWarnings: ack });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`Published version ${res.data?.version}${mode === "testing" ? " for test numbers" : ""}`);
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
