"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction, confirmFactorReplacementAction, startFactorReplacementAction } from "@/app/(dashboard)/settings/security/actions";

export function ReplaceAuthenticator({ factorCount }: { factorCount: number }) {
  const [enroll, setEnroll] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4" /> Authenticator app
        </CardTitle>
        <CardDescription>{factorCount} verified authenticator(s). Replacing it removes the old one only after the new one is verified.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!enroll ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await startFactorReplacementAction();
                if (r.ok && r.data) setEnroll(r.data);
                else if (!r.ok) toast.error(r.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Replace authenticator
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center rounded-2xl border bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qrCode} alt="New authenticator QR code" className="size-44" />
            </div>
            <code className="block rounded-xl bg-muted px-3 py-2 text-xs break-all">{enroll.secret}</code>
            <div className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Code from the new app" inputMode="numeric" />
              <Button
                disabled={pending || code.length !== 6}
                onClick={() =>
                  start(async () => {
                    const r = await confirmFactorReplacementAction({ factorId: enroll.factorId, code });
                    if (r.ok) {
                      toast.success("Authenticator replaced");
                      setEnroll(null);
                      setCode("");
                    } else toast.error(r.error);
                  })
                }
              >
                Verify
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ChangePassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Change password</CardTitle>
        <CardDescription>At least 10 characters with letters and numbers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">New password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Confirm</Label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <Button
          disabled={pending || !password}
          onClick={() =>
            start(async () => {
              const r = await changePasswordAction({ password, confirm });
              if (r.ok) {
                toast.success("Password changed");
                setPassword("");
                setConfirm("");
              } else toast.error(r.error);
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />} Update password
        </Button>
      </CardContent>
    </Card>
  );
}
