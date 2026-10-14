import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  const [{ data: logs }, { data: profiles }] = await Promise.all([
    supabase.from("audit_logs").select("id, actor_id, actor_type, action, entity_type, entity_id, detail, created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name, email, login_id"),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.login_id ?? p.email]));
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(logs ?? []).map((l) => (
            <TableRow key={l.id}>
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{fmtDate(l.created_at)}</TableCell>
              <TableCell className="text-sm">{l.actor_id ? (names.get(l.actor_id) ?? "user") : "system"}</TableCell>
              <TableCell className="font-mono text-xs">{l.action}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {l.entity_type ?? ""} {l.entity_id ? `· ${String(l.entity_id).slice(0, 8)}` : ""}
              </TableCell>
              <TableCell className="max-w-80 truncate text-xs text-muted-foreground" title={l.detail ? JSON.stringify(l.detail) : ""}>
                {l.detail ? JSON.stringify(l.detail) : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
