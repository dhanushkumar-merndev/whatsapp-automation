"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteUserAction, resetUserMfaAction, updateUserAction } from "@/app/(dashboard)/settings/users/actions";

type Role = "owner" | "admin" | "staff";

export function InviteUserDialog({ canAddOwner }: { canAddOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [method, setMethod] = useState<"email" | "password">("password");
  const [temp, setTemp] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o || setTemp(null))}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an administrator</DialogTitle>
          <DialogDescription>Public sign-up is disabled. Every new user must set up an authenticator app at first sign-in.</DialogDescription>
        </DialogHeader>
        {temp ? (
          <div className="space-y-3">
            <p className="text-sm">Share this temporary password securely. It is shown only once; ask the user to change it under Settings → Security.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl bg-muted px-3 py-2 text-sm">{temp}</code>
              <Button size="icon-sm" variant="outline" onClick={() => navigator.clipboard.writeText(temp)} aria-label="Copy">
                <Copy />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => (setOpen(false), setTemp(null))}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Email or login ID</Label>
                <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="name@company.com or LoginID" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Full name</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff — leads & conversations</SelectItem>
                    <SelectItem value="admin">Admin — everything except owners</SelectItem>
                    {canAddOwner && <SelectItem value="owner">Owner</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <RadioGroup value={method} onValueChange={(v) => setMethod(v as "email" | "password")} className="gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="password" /> Create with a temporary password
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="email" /> Send an email invitation (email logins only)
                </label>
              </RadioGroup>
            </div>
            <DialogFooter>
              <Button
                disabled={pending || login.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const r = await inviteUserAction({ login, fullName, role, method });
                    if (!r.ok) return void toast.error(r.error);
                    router.refresh();
                    if (r.data?.tempPassword) setTemp(r.data.tempPassword);
                    else {
                      toast.success("Invitation sent");
                      setOpen(false);
                    }
                  })
                }
              >
                {pending && <Loader2 className="animate-spin" />} Add user
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UserRowActions({ userId, role, status, actorRole, isSelf }: { userId: string; role: Role; status: string; actorRole: Role; isSelf: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mfaOpen, setMfaOpen] = useState(false);
  const [code, setCode] = useState("");
  if (isSelf) return <span className="text-xs text-muted-foreground">You</span>;
  const canManage = role !== "owner" || actorRole === "owner";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(msg);
        router.refresh();
      } else toast.error(r.error);
    });
  if (!canManage) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="User actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(["staff", "admin", ...(actorRole === "owner" ? (["owner"] as const) : [])] as Role[])
            .filter((r) => r !== role)
            .map((r) => (
              <DropdownMenuItem key={r} onSelect={() => run(() => updateUserAction({ userId, role: r }), `Role changed to ${r}`)}>
                Make {r}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setMfaOpen(true)}>
            <KeyRound /> Reset MFA
          </DropdownMenuItem>
          {status === "disabled" ? (
            <DropdownMenuItem onSelect={() => run(() => updateUserAction({ userId, status: "active" }), "User enabled")}>Enable</DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onSelect={() => run(() => updateUserAction({ userId, status: "disabled" }), "User disabled")}>
              Disable
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={mfaOpen} onOpenChange={setMfaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset two-factor authentication</DialogTitle>
            <DialogDescription>
              Removes this user&apos;s authenticators so they can enroll a new one at next sign-in. Confirm with your own current code. This is recorded in the
              audit log.
            </DialogDescription>
          </DialogHeader>
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Your 6-digit code" inputMode="numeric" />
          <DialogFooter>
            <Button
              disabled={pending || code.length !== 6}
              onClick={() =>
                run(async () => {
                  const r = await resetUserMfaAction({ userId, code });
                  if (r.ok) setMfaOpen(false);
                  setCode("");
                  return r;
                }, "MFA reset — the user must enroll again")
              }
            >
              {pending && <Loader2 className="animate-spin" />} Reset MFA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
