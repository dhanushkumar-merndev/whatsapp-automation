import type { Metadata } from "next";
import { AlertTriangle, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountForm, TestAccountButton, DeleteAccountButton } from "@/components/whatsapp/account-form";
import { ConnectBusinessApp } from "@/components/whatsapp/connect-business-app";
import { RetrySyncButton } from "@/components/whatsapp/retry-sync-button";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo } from "@/lib/format";

export const metadata: Metadata = { title: "WhatsApp Accounts" };

/** Meta allows the one-time contacts / history share only within 24 hours of connecting. */
function withinSyncWindow(onboardedAt: string) {
  return Date.now() - new Date(onboardedAt).getTime() < 24 * 3_600_000;
}

export default async function WhatsAppPage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("whatsapp_accounts")
    .select(
      "id, name, waba_id, phone_number_id, display_phone_number, verified_name, quality_rating, enabled, last_verified_at, coexistence, is_on_biz_app, onboarded_at, contacts_sync_requested_at, history_sync_requested_at",
    )
    .order("created_at");
  const metaAppId = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const metaConfigId = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? "";
  const connect = metaAppId && metaConfigId ? <ConnectBusinessApp appId={metaAppId} configId={metaConfigId} graphVersion={process.env.META_GRAPH_API_VERSION ?? "v23.0"} /> : null;

  return (
    <>
      <PageHeader
        title="WhatsApp Accounts"
        description="Your WhatsApp numbers. A Business app number keeps working on your phone while the bot answers here (coexistence)."
        actions={
          <>
            <AccountForm />
            {connect}
          </>
        }
      />
      {!connect && (
        <p className="mb-5 rounded-2xl border p-3 text-sm text-muted-foreground">
          To connect a number that is on the WhatsApp Business app, set <code>NEXT_PUBLIC_META_APP_ID</code> and <code>NEXT_PUBLIC_META_CONFIG_ID</code> (see the setup
          guide), then reload this page.
        </p>
      )}
      {!accounts?.length ? (
        <EmptyState
          icon={Smartphone}
          title="No WhatsApp number yet"
          description="Add your Meta WhatsApp Cloud API number to start receiving customer messages."
          action={connect ?? <AccountForm />}
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
                {a.coexistence && (
                  <div className="space-y-1.5 rounded-xl bg-muted/60 p-2.5 text-xs">
                    <div className="font-medium">WhatsApp Business app + bot (coexistence)</div>
                    <div className="text-muted-foreground">
                      {a.is_on_biz_app === false ? "Meta does not report this number as on the Business app." : "Your replies from the phone pause the bot in that chat."}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Contacts: {a.contacts_sync_requested_at ? `shared ${fmtAgo(a.contacts_sync_requested_at)}` : "not shared"}</span>
                      <span>· History: {a.history_sync_requested_at ? `requested ${fmtAgo(a.history_sync_requested_at)}` : "not requested"}</span>
                    </div>
                    {a.onboarded_at && withinSyncWindow(a.onboarded_at) && (
                      <div className="flex flex-wrap gap-2">
                        {!a.contacts_sync_requested_at && <RetrySyncButton id={a.id} kind="smb_app_state_sync" label="Share contacts" />}
                        {!a.history_sync_requested_at && <RetrySyncButton id={a.id} kind="history" label="Import chat history" />}
                      </div>
                    )}
                  </div>
                )}
                {!a.enabled && (
                  <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Disabled: messages to this number are ignored.
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
