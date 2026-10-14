import type { Metadata } from "next";
import Link from "next/link";
import { Download, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeadFilters } from "@/components/leads/lead-filters";
import { requirePageSession } from "@/lib/auth/guard";
import { roleAllows } from "@/lib/auth/steps";
import { createClient } from "@/lib/supabase/server";
import { LEAD_VIEWS, fetchLeads, parseLeadFilters, type LeadView } from "@/lib/server/lead-query";
import { STAR_SERVICES } from "@/lib/flows/default-flow";
import { fmtAgo, fmtNumber, fmtPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };
const PAGE_SIZE = 25;

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const session = await requirePageSession("staff");
  const sp = await searchParams;
  const filters = parseLeadFilters(sp);
  if (filters.assigned === "me") filters.assigned = session.userId;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const [{ data: leads, count, error }, { data: staff }, { data: serviceRows }] = await Promise.all([
    fetchLeads(supabase, filters, { from: (page - 1) * PAGE_SIZE, to: page * PAGE_SIZE - 1 }),
    supabase.from("profiles").select("id, full_name, email").eq("status", "active"),
    supabase.from("leads").select("service").not("service", "is", null).limit(500),
  ]);
  const staffMap = new Map((staff ?? []).map((s) => [s.id, s.full_name || s.email]));
  const services = [...new Set([...STAR_SERVICES.map((s) => s.title), ...(serviceRows ?? []).map((r) => r.service as string)])];
  const total = count ?? 0;
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every enquiry captured by your flows. Partial answers are kept as incomplete enquiries."
        actions={
          roleAllows(session.role, "admin") && (
            <Button variant="outline" asChild>
              <a href={`/api/leads/export${qs({ page: "" })}`}>
                <Download /> Export CSV
              </a>
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(LEAD_VIEWS) as LeadView[]).map((v) => (
          <Link
            key={v}
            href={`/leads${qs({ view: v === "all" ? "" : v, page: "" })}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              filters.view === v ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {LEAD_VIEWS[v]}
          </Link>
        ))}
      </div>
      <div className="mb-4">
        <LeadFilters services={services} staff={(staff ?? []).map((s) => ({ id: s.id, name: s.full_name || s.email }))} />
      </div>
      {error && <p className="mb-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error.message}</p>}
      {!leads?.length ? (
        <EmptyState icon={UsersRound} title="No leads match" description="Leads appear here as soon as customers answer your WhatsApp flow." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CRM</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id} className="relative cursor-pointer">
                  <TableCell>
                    <Link href={`/leads/${l.id}`} className="block after:absolute after:inset-0">
                      <div className="font-medium">{l.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtPhone(l.phone)}
                        {l.business_name ? ` · ${l.business_name}` : ""}
                        {l.is_test && " · test"}
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">{l.service ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={l.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={l.crm_sync_status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.assigned_to ? (staffMap.get(l.assigned_to) ?? "—") : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtAgo(l.last_activity_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {fmtNumber((page - 1) * PAGE_SIZE + 1)}–{fmtNumber(Math.min(page * PAGE_SIZE, total))} of {fmtNumber(total)}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/leads${qs({ page: String(page - 1) })}`}>Previous</Link>
              </Button>
            )}
            {page * PAGE_SIZE < total && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/leads${qs({ page: String(page + 1) })}`}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
