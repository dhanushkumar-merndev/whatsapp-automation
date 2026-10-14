import type { Metadata } from "next";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewFlowDialog } from "@/components/flows/new-flow-dialog";
import { FlowRowActions } from "@/components/flows/flow-row-actions";
import { LevelPill } from "@/components/builder/usage-report";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo, fmtNumber } from "@/lib/format";
import type { EstimateSnapshot } from "@/lib/estimator/estimate";

export const metadata: Metadata = { title: "My Flows" };

export default async function FlowsPage({ searchParams }: PageProps<"/flows">) {
  await requirePageSession("admin");
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const supabase = await createClient();
  let q = supabase
    .from("flows")
    .select("id, name, description, status, priority, draft_updated_at, published_version_id, estimate_snapshot, flow_versions!flow_versions_flow_id_fkey(version, created_at)")
    .order("draft_updated_at", { ascending: false });
  if (!showArchived) q = q.neq("status", "archived");
  const { data: flows, error } = await q;

  const ids = (flows ?? []).map((f) => f.id);
  const { data: running } = ids.length
    ? await supabase.from("flow_executions").select("flow_id").in("flow_id", ids).in("status", ["running", "waiting_input", "waiting_delay"])
    : { data: [] };
  const runningCount = new Map<string, number>();
  for (const r of running ?? []) runningCount.set(r.flow_id, (runningCount.get(r.flow_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="My Flows"
        description="Customer-initiated WhatsApp automations. Lower priority numbers are matched first."
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href={showArchived ? "/flows" : "/flows?archived=1"}>{showArchived ? "Hide archived" : "Show archived"}</Link>
            </Button>
            <NewFlowDialog defaultOpen={sp.new === "1"} />
          </>
        }
      />
      {error && <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error.message}</p>}
      {!flows?.length ? (
        <EmptyState
          icon={Workflow}
          title="No flows yet"
          description="Create the Star Growth Hub enquiry flow from the template, or start from scratch."
          action={<NewFlowDialog />}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flow</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Live version</TableHead>
                <TableHead className="hidden text-right md:table-cell">In progress</TableHead>
                <TableHead className="hidden lg:table-cell">Projected usage</TableHead>
                <TableHead className="hidden sm:table-cell">Edited</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {flows.map((f) => {
                const versions = (f.flow_versions as { version: number; created_at: string }[] | null) ?? [];
                const latest = versions.reduce((m, v) => Math.max(m, v.version), 0);
                const snap = f.estimate_snapshot as EstimateSnapshot | null;
                return (
                  <TableRow key={f.id} className="relative">
                    <TableCell>
                      <Link href={`/flows/${f.id}`} className="font-medium after:absolute after:inset-0">
                        {f.name}
                      </Link>
                      {f.description && <div className="max-w-md truncate text-xs text-muted-foreground">{f.description}</div>}
                      <div className="text-[11px] text-muted-foreground">Priority {f.priority}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={f.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.published_version_id ? `v${latest}` : <span className="text-xs text-muted-foreground">Draft — not published</span>}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtNumber(runningCount.get(f.id) ?? 0)}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {snap ? (
                        <div className="space-y-0.5">
                          <LevelPill level={snap.overallLevel} />
                          <div className="text-[11px] text-muted-foreground">
                            {fmtNumber(snap.whatsappPerDay)} replies · {fmtNumber(snap.qstashPerDay, 1)} QStash / day
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not published</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtAgo(f.draft_updated_at)}</TableCell>
                    <TableCell className="relative z-10">
                      <FlowRowActions id={f.id} status={f.status} published={Boolean(f.published_version_id)} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
