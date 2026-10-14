import type { Metadata } from "next";
import { StatusBadge } from "@/components/common/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InviteUserDialog, UserRowActions } from "@/components/settings/user-admin";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const session = await requirePageSession("admin");
  const supabase = await createClient();
  const { data: users } = await supabase.from("profiles").select("id, email, login_id, full_name, role, status, mfa_enrolled_at, last_login_at").order("created_at");
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Only people listed here can sign in. Each one must use an authenticator app.</p>
        <InviteUserDialog canAddOwner={session.role === "owner"} />
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>MFA</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.full_name ?? u.login_id ?? u.email}</div>
                  <div className="text-xs text-muted-foreground">{u.login_id ?? u.email}</div>
                </TableCell>
                <TableCell className="text-sm capitalize">{u.role}</TableCell>
                <TableCell>
                  <StatusBadge status={u.status} />
                </TableCell>
                <TableCell>{u.mfa_enrolled_at ? <StatusBadge status="enrolled" tone="green" /> : <StatusBadge status="not set up" tone="amber" />}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{u.last_login_at ? fmtAgo(u.last_login_at) : "never"}</TableCell>
                <TableCell className="text-right">
                  <UserRowActions userId={u.id} role={u.role} status={u.status} actorRole={session.role} isSelf={u.id === session.userId} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
