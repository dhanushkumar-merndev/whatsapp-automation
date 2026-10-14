"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveIntegrationAction } from "@/app/(dashboard)/crm/actions";
import { CRM_SOURCE_FIELDS } from "@/lib/engine/crm-payload";

export interface IntegrationFormValue {
  id: string | null;
  name: string;
  url: string;
  enabled: boolean;
  authType: "none" | "bearer" | "basic" | "header";
  hasCredentials: boolean;
  hasSigningSecret: boolean;
  fieldMapping: Record<string, string>;
}

const EMPTY: IntegrationFormValue = {
  id: null,
  name: "My CRM",
  url: "",
  enabled: true,
  authType: "none",
  hasCredentials: false,
  hasSigningSecret: false,
  fieldMapping: {},
};

export function IntegrationForm({ initial }: { initial?: IntegrationFormValue }) {
  const router = useRouter();
  const v0 = initial ?? EMPTY;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(v0.name);
  const [url, setUrl] = useState(v0.url);
  const [enabled, setEnabled] = useState(v0.enabled);
  const [authType, setAuthType] = useState(v0.authType);
  const [cred, setCred] = useState({ token: "", username: "", password: "", headerName: "", headerValue: "" });
  const [signing, setSigning] = useState<"keep" | "generate" | "none">(v0.hasSigningSecret ? "keep" : "generate");
  const [mapping, setMapping] = useState<Record<string, string>>({ ...Object.fromEntries(CRM_SOURCE_FIELDS.map((f) => [f, f])), ...v0.fieldMapping });
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const keepHint = v0.hasCredentials ? "Leave blank to keep the saved value" : undefined;

  const submit = () =>
    start(async () => {
      const r = await saveIntegrationAction({ id: v0.id, name, url, enabled, authType, credentials: cred, signing, fieldMapping: mapping });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Integration saved");
      router.refresh();
      if (r.data?.signingSecret) setSecret(r.data.signingSecret);
      else setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || setSecret(null))}>
      <DialogTrigger asChild>
        {v0.id ? (
          <Button variant="outline" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> Add CRM webhook
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{v0.id ? "Edit CRM webhook" : "Add CRM webhook"}</DialogTitle>
          <DialogDescription>Leads are saved locally first and then POSTed to this URL as JSON, signed with HMAC-SHA256.</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="space-y-3">
            <p className="text-sm">Copy your signing secret now — it will not be shown again. Configure your CRM to verify the <code>X-SGH-Signature</code> header with it.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl bg-muted px-3 py-2 text-xs break-all">{secret}</code>
              <Button size="icon-sm" variant="outline" onClick={() => navigator.clipboard.writeText(secret)} aria-label="Copy">
                <Copy />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => (setOpen(false), setSecret(null))}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </div>
              <div className="flex items-end justify-between gap-2 pb-2">
                <Label className="text-xs">Enabled</Label>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Webhook URL (HTTPS)</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.example.com/webhooks/whatsapp-leads" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Authentication</Label>
              <Select value={authType} onValueChange={(v) => setAuthType(v as typeof authType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (signature only)</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="basic">Basic auth</SelectItem>
                  <SelectItem value="header">Custom header</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {authType === "bearer" && (
              <Input type="password" placeholder={keepHint ?? "Token"} value={cred.token} onChange={(e) => setCred({ ...cred, token: e.target.value })} autoComplete="off" />
            )}
            {authType === "basic" && (
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder={keepHint ?? "Username"} value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} autoComplete="off" />
                <Input type="password" placeholder={keepHint ?? "Password"} value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} autoComplete="off" />
              </div>
            )}
            {authType === "header" && (
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder={keepHint ?? "Header name (e.g. X-Api-Key)"} value={cred.headerName} onChange={(e) => setCred({ ...cred, headerName: e.target.value })} autoComplete="off" />
                <Input type="password" placeholder={keepHint ?? "Header value"} value={cred.headerValue} onChange={(e) => setCred({ ...cred, headerValue: e.target.value })} autoComplete="off" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">HMAC signing secret</Label>
              <Select value={signing} onValueChange={(v) => setSigning(v as typeof signing)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {v0.hasSigningSecret && <SelectItem value="keep">Keep current secret</SelectItem>}
                  <SelectItem value="generate">{v0.hasSigningSecret ? "Rotate (generate a new secret)" : "Generate a secret"}</SelectItem>
                  <SelectItem value="none">Don&apos;t sign requests</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <details className="rounded-2xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">Field mapping</summary>
              <p className="mt-1 text-xs text-muted-foreground">JSON key sent to your CRM for each lead field. Empty = don&apos;t send.</p>
              <div className="mt-3 grid gap-2">
                {CRM_SOURCE_FIELDS.map((f) => (
                  <div key={f} className="grid grid-cols-2 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{f}</span>
                    <Input value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })} className="h-8 font-mono text-xs" />
                  </div>
                ))}
              </div>
            </details>
            <DialogFooter>
              <Button onClick={submit} disabled={pending || !url}>
                {pending && <Loader2 className="animate-spin" />} Save
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
