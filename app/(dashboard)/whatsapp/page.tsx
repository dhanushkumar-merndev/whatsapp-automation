import type { Metadata } from "next";
import { AlertTriangle, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { CopyButton } from "@/components/common/copy-button";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountForm, TestAccountButton, DeleteAccountButton } from "@/components/whatsapp/account-form";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo } from "@/lib/format";

export const metadata: Metadata = { title: "WhatsApp Accounts" };

export default async function WhatsAppPage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("whatsapp_accounts").select("*").order("created_at");
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const envWaba = process.env.META_WABA_ID ?? "";

  return (
    <>
      <PageHeader title="WhatsApp Accounts" description="Official Meta WhatsApp Cloud API numbers. Events for unregistered numbers are rejected." actions={<AccountForm />} />
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-sm">Webhook configuration (Meta → WhatsApp → Configuration)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Callback URL</div>
            <div className="mt-1 flex items-center gap-1 rounded-xl bg-muted py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 text-xs break-all">{appUrl}/api/webhooks/whatsapp</code>
              <CopyButton value={`${appUrl}/api/webhooks/whatsapp`} />
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Verify token</div>
            <div className="mt-1 rounded-xl bg-muted px-3 py-2 text-xs">The value of META_WEBHOOK_VERIFY_TOKEN (server environment; never shown here)</div>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Subscribe the <b>messages</b> field. Every request is verified with your App Secret (X-Hub-Signature-256). The bot only replies to customers
            who message first.
          </p>
        </CardContent>
      </Card>
      {!accounts?.length ? (
        <EmptyState
          icon={Smartphone}
          title="No WhatsApp number yet"
          description="Add your Meta WhatsApp Cloud API number to start receiving customer messages."
          action={<AccountForm />}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span>{a.verified_name ?? a.name}</span>
                  <StatusBadge status={a.enabled ? "enabled" : "disabled"} tone={a.enabled ? "green" : "gray"} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Display number</div>
                    {a.display_phone_number ?? "— (test connection)"}
                  </div>
                  <div>
                    <div className="text-muted-foreground">Quality rating</div>
                    {a.quality_rating ?? "—"}
                  </div>
                  <div>
                    <div className="text-muted-foreground">WABA ID</div>
                    <span className="font-mono break-all">{a.waba_id}</span>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Phone number ID</div>
                    <span className="font-mono break-all">{a.phone_number_id}</span>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Last verified</div>
                    {a.last_verified_at ? fmtAgo(a.last_verified_at) : "never"}
                  </div>
                </div>
                {envWaba && a.waba_id !== envWaba && (
                  <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> This WABA ID differs from META_WABA_ID; its webhook events will be rejected.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <TestAccountButton id={a.id} />
                  <AccountForm initial={{ id: a.id, name: a.name, wabaId: a.waba_id, phoneNumberId: a.phone_number_id, enabled: a.enabled }} />
                  {!a.enabled && <DeleteAccountButton id={a.id} name={a.verified_name ?? a.name} />}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
