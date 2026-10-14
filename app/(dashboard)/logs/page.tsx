import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo, fmtDate, fmtPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Execution Logs" };

const TABS = { executions: "Executions", jobs: "Scheduled jobs", security: "Security events" } as const;
type Tab = keyof typeof TABS;
const STATUSES = ["running", "waiting_input", "waiting_delay", "completed", "handoff", "window_expired", "failed", "cancelled", "paused", "abandoned"];

export default async function LogsPage({ searchParams }: PageProps<"/logs">) {
  await requirePageSession("admin");
  const sp = await searchParams;
  const tab = (typeof sp.tab === "string" && sp.tab in TABS ? sp.tab : "executions") as Tab;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : "";
  const executionId = typeof sp.execution === "string" && /^[0-9a-f-]{36}$/.test(sp.execution) ? sp.execution : "";
  const supabase = await createClient();

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { tab, status, execution: executionId, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "tab" && v === "executions")) p.set(k, v);
    const s = p.toString();
    return `/logs${s ? `?${s}` : ""}`;
  };

  let content: React.ReactNode = null;

  if (tab === "executions") {
    let q = supabase
      .from("flow_executions")
      .select("id, status, started_at, last_activity_at, current_node_id, error, is_test, step, flows(name), contacts(wa_id, name, profile_name)")
      .order("started_at", { ascending: false })
      .limit(60);
    if (status) q = q.eq("status", status);
    const [{ data: executions }, detail] = await Promise.all([
      q,
      executionId
        ? supabase.from("node_executions").select("id, node_id, node_type, step, status, output_handle, detail, error, duration_ms, created_at").eq("execution_id", executionId).order("id")
        : Promise.resolve({ data: null }),
    ]);
    content = (
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className={cn("py-0", executionId ? "lg:col-span-3" : "lg:col-span-5")}>
          <div className="flex flex-wrap gap-1.5 p-4">
            <Link href={link({ status: "" })} className={cn("rounded-full border px-3 py-1 text-xs", !status ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
              All
            </Link>
            {STATUSES.map((s) => (
              <Link key={s} href={link({ status: s })} className={cn("rounded-full border px-3 py-1 text-xs", status === s ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
                {s.replace(/_/g, " ")}
              </Link>
            ))}
          </div>
          {!executions?.length ? (
            <div className="p-6">
              <EmptyState icon={ScrollText} title="No executions" description="Executions appear when customers message your number." />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Flow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((e) => {
                  const f = (Array.isArray(e.flows) ? e.flows[0] : e.flows) as { name: string } | null;
                  const c = (Array.isArray(e.contacts) ? e.contacts[0] : e.contacts) as { wa_id: string; name: string | null; profile_name: string | null } | null;
                  return (
                    <TableRow key={e.id} className={cn(e.id === executionId && "bg-muted/60")}>
                      <TableCell>
                        <Link href={link({ execution: e.id })} className="block hover:underline">
                          {c?.name ?? c?.profile_name ?? fmtPhone(c?.wa_id)}
                          {e.is_test && <span className="ml-1 text-xs text-muted-foreground">(test)</span>}
                        </Link>
                        {e.error && <div className="max-w-72 truncate text-xs text-destructive">{e.error}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{f?.name ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtAgo(e.started_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
        {executionId && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-sm">
                Execution trace
                <Link href={link({ execution: "" })} className="text-xs font-normal text-muted-foreground hover:text-foreground">
                  Close
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-3 border-l pl-4">
                {(detail.data ?? []).map((n) => (
                  <li key={n.id} className="relative">
                    <span
                      className={cn(
                        "absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background",
                        n.status === "failed" ? "bg-destructive" : n.status === "waiting" ? "bg-info" : n.status === "skipped" ? "bg-muted-foreground/40" : "bg-success",
                      )}
                    />
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{n.node_type.replace(/_/g, " ")}</span>
                      <StatusBadge status={n.status} />
                      {n.output_handle && n.output_handle !== "out" && <span className="text-xs text-muted-foreground">→ {n.output_handle}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      step {n.step} · {n.node_id} · {fmtDate(n.created_at, "HH:mm:ss")}
                      {n.duration_ms !== null ? ` · ${n.duration_ms} ms` : ""}
                    </div>
                    {n.error && <div className="mt-0.5 text-xs text-destructive">{n.error}</div>}
                    {n.detail && Object.keys(n.detail as object).length > 0 && (
                      <pre className="mt-1 max-h-28 overflow-auto rounded-lg bg-muted p-2 text-[10px] leading-snug">{JSON.stringify(n.detail, null, 1)}</pre>
                    )}
                  </li>
                ))}
                {!detail.data?.length && <p className="text-sm text-muted-foreground">No steps recorded.</p>}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    );
  } else if (tab === "jobs") {
    const { data: jobs } = await supabase
      .from("scheduled_jobs")
      .select("id, kind, status, run_at, attempts, last_error, qstash_message_id, execution_id, is_test, created_at")
      .order("created_at", { ascending: false })
      .limit(80);
    content = (
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Run at</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>QStash message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(jobs ?? []).map((j) => (
              <TableRow key={j.id}>
                <TableCell className="text-sm">
                  {j.execution_id ? <Link href={link({ tab: "executions", execution: j.execution_id })} className="hover:underline">{j.kind}</Link> : j.kind}
                  {j.is_test && <span className="ml-1 text-xs text-muted-foreground">(test)</span>}
                </TableCell>
                <TableCell>
                  <StatusBadge status={j.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(j.run_at, "d MMM HH:mm:ss")}</TableCell>
                <TableCell className="tabular-nums">{j.attempts}</TableCell>
                <TableCell className="max-w-64 truncate text-xs text-destructive">{j.last_error ?? ""}</TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">{j.qstash_message_id ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  } else {
    const { data: events } = await supabase.from("rate_limit_events").select("id, scope, action, identifier, detail, created_at").order("created_at", { ascending: false }).limit(100);
    content = (
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Identifier (hashed)</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(events ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(e.created_at)}</TableCell>
                <TableCell className="text-sm">{e.scope}</TableCell>
                <TableCell>
                  <StatusBadge status={e.action} tone="amber" />
                </TableCell>
                <TableCell className="font-mono text-[11px]">{e.identifier}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{e.detail ? JSON.stringify(e.detail) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Execution Logs" description="Every automation step, delayed job and security event — newest first." />
      <div className="mb-4 inline-flex rounded-full bg-muted p-1">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={t === "executions" ? "/logs" : `/logs?tab=${t}`}
            className={cn("rounded-full px-3.5 py-1 text-xs font-medium", tab === t ? "bg-background shadow-sm dark:bg-accent" : "text-muted-foreground hover:text-foreground")}
          >
            {TABS[t]}
          </Link>
        ))}
      </div>
      {content}
    </>
  );
}
