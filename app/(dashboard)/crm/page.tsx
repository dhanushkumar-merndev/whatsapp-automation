import type { Metadata } from "next";
import Link from "next/link";
import { Plug } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IntegrationForm } from "@/components/crm/integration-form";
import { DeleteIntegrationButton, RetryDeliveryButton, TestIntegrationButton } from "@/components/crm/integration-buttons";
import { requirePageSession } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo } from "@/lib/format";

export const metadata: Metadata = { title: "CRM Integrations" };

export default async function CrmPage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  // Secrets are never selected for the browser; only whether they exist.
  const [{ data: integrations }, { data: secretFlags }, { data: deliveries }] = await Promise.all([
    supabase.from("crm_integrations").select("id, name, url, enabled, auth_type, field_mapping, last_success_at, last_failure_at, last_error").order("created_at"),
    createAdminClient().from("crm_integrations").select("id, credentials_encrypted, signing_secret_encrypted"),
    supabase
      .from("crm_deliveries")
      .select("id, status, attempts, last_status_code, last_error, updated_at, event_id, lead_id, is_test, crm_integrations(name), leads(name, phone)")
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  const flags = new Map((secretFlags ?? []).map((s) => [s.id, { cred: Boolean(s.credentials_encrypted), sig: Boolean(s.signing_secret_encrypted) }]));

  return (
    <>
      <PageHeader
        title="CRM Integrations"
        description="Send every captured lead to your CRM. Events carry a stable event_id and Idempotency-Key so retries never create duplicates."
        actions={<IntegrationForm />}
      />
      {!integrations?.length ? (
        <EmptyState icon={Plug} title="No CRM connected" description="Add the receiving webhook URL from your CRM. Leads are stored here even if the CRM is down." action={<IntegrationForm />} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {integrations.map((i) => (
            <Card key={i.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="truncate">{i.name}</span>
                  <StatusBadge status={i.enabled ? "enabled" : "disabled"} tone={i.enabled ? "green" : "gray"} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="truncate font-mono text-xs text-muted-foreground">{i.url}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Auth: {i.auth_type}</span>
                  <span>Signed: {flags.get(i.id)?.sig ? "yes" : "no"}</span>
                  <span>Last success: {i.last_success_at ? fmtAgo(i.last_success_at) : "never"}</span>
                </div>
                {i.last_error && (
                  <p className="rounded-xl bg-red-50 p-2 text-xs text-red-700">
                    Last error ({fmtAgo(i.last_failure_at)}): {i.last_error}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <TestIntegrationButton id={i.id} />
                  <IntegrationForm
                    initial={{
                      id: i.id,
                      name: i.name,
                      url: i.url,
                      enabled: i.enabled,
                      authType: i.auth_type,
                      hasCredentials: flags.get(i.id)?.cred ?? false,
                      hasSigningSecret: flags.get(i.id)?.sig ?? false,
                      fieldMapping: (i.field_mapping as Record<string, string>) ?? {},
                    }}
                  />
                  <DeleteIntegrationButton id={i.id} name={i.name} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6 py-0">
        <CardHeader className="pt-5">
          <CardTitle className="text-sm">Recent deliveries</CardTitle>
        </CardHeader>
        {!deliveries?.length ? (
          <CardContent className="pb-5 text-sm text-muted-foreground">No deliveries yet.</CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>CRM</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Last result</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((d) => {
                const lead = (Array.isArray(d.leads) ? d.leads[0] : d.leads) as { name: string | null; phone: string } | null;
                const integ = (Array.isArray(d.crm_integrations) ? d.crm_integrations[0] : d.crm_integrations) as { name: string } | null;
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/leads/${d.lead_id}`} className="hover:underline">
                        {lead?.name ?? lead?.phone ?? "Lead"}
                      </Link>
                      {d.is_test && <span className="ml-1 text-xs text-muted-foreground">(test)</span>}
                    </TableCell>
                    <TableCell className="text-sm">{integ?.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{d.attempts}</TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={d.last_error ?? ""}>
                      {d.last_status_code ? `HTTP ${d.last_status_code}` : ""} {d.last_error ?? (d.status === "succeeded" ? "OK" : "")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtAgo(d.updated_at)}</TableCell>
                    <TableCell>{d.status !== "succeeded" && <RetryDeliveryButton id={d.id} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
