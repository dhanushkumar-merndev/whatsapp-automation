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
import { FlowLiveButton } from "@/components/flows/flow-live-button";
import { AiPromptDialog } from "@/components/flows/ai-prompt-dialog";
import { ImportFlowDialog } from "@/components/flows/import-flow-dialog";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo, fmtNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Workflows" };

const STATUS_LABEL: Record<string, string> = { active: "live", testing: "test numbers", paused: "paused", draft: "draft", archived: "archived" };

export default async function FlowsPage({ searchParams }: PageProps<"/flows">) {
  await requirePageSession("admin");
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const supabase = await createClient();
  let q = supabase
    .from("flows")
    .select("id, name, description, status, draft_updated_at, published_version_id, flow_versions!flow_versions_flow_id_fkey(version, created_at)")
    .order("draft_updated_at", { ascending: false });
  if (!showArchived) q = q.neq("status", "archived");
  const { data: flows, error } = await q;

  const ids = (flows ?? []).map((f) => f.id);
  const { data: running } = ids.length
    ? await supabase.from("flow_executions").select("flow_id").in("flow_id", ids).in("status", ["running", "waiting_input", "waiting_delay"])
    : { data: [] };
  const runningCount = new Map<string, number>();
  for (const r of running ?? []) runningCount.set(r.flow_id, (runningCount.get(r.flow_id) ?? 0) + 1);
  // The live workflow first, then the test one, then the rest by last edit.
  const order = (s: string) => (s === "active" ? 0 : s === "testing" ? 1 : 2);
  const sorted = [...(flows ?? [])].sort((a, b) => order(a.status) - order(b.status));
  const live = sorted.find((f) => f.status === "active");

  return (
    <>
      <PageHeader
        title="Workflows"
        description={
          live
            ? `“${live.name}” answers every customer. Keep as many workflows as you like; one is live at a time.`
            : "No workflow is live, so the bot does not reply. Publish one and make it live."
        }
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href={showArchived ? "/flows" : "/flows?archived=1"}>{showArchived ? "Hide archived" : "Show archived"}</Link>
            </Button>
            <AiPromptDialog />
            <ImportFlowDialog mode="create" />
            <NewFlowDialog defaultOpen={sp.new === "1"} />
          </>
        }
      />
      {error && <p className="mb-4 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error.message}</p>}
      {!sorted.length ? (
        <EmptyState
          icon={Workflow}
          title="No workflows yet"
          description="Build one with ChatGPT (copy the prompt, describe what you need, import the JSON), or start from an empty workflow."
          action={<AiPromptDialog />}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Live</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="hidden text-right md:table-cell">Chats in progress</TableHead>
                <TableHead className="hidden sm:table-cell">Edited</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((f) => {
                const versions = (f.flow_versions as { version: number; created_at: string }[] | null) ?? [];
                const latest = versions.reduce((m, v) => Math.max(m, v.version), 0);
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Link href={`/flows/${f.id}`} className="font-medium hover:underline">
                        {f.name}
                      </Link>
                      {f.description && <div className="max-w-md truncate text-xs text-muted-foreground">{f.description}</div>}
                    </TableCell>
                    <TableCell>
                      <FlowLiveButton id={f.id} status={f.status} published={Boolean(f.published_version_id)} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={f.status} label={STATUS_LABEL[f.status]} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.published_version_id ? `v${latest}` : <span className="text-xs text-muted-foreground">Not published</span>}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtNumber(runningCount.get(f.id) ?? 0)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtAgo(f.draft_updated_at)}</TableCell>
                    <TableCell>
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
