"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RESTORABLE_TABLES, isBackupFile, type BackupFile, type BackupTable } from "@/lib/data-backup";
import { finishRestoreAction, restoreRowsAction } from "@/app/(dashboard)/settings/data/actions";

type Row = Record<string, unknown>;
type Totals = Record<string, { inserted: number; skipped: number; failed: number }>;

const MAX_ROWS = 500;
const MAX_BYTES = 600_000; // stays well under the request size limit

/** Splits rows into pieces that are small enough to send in one request. */
function chunk(rows: Row[]): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] = [];
  let bytes = 0;
  for (const r of rows) {
    const size = JSON.stringify(r).length;
    if (cur.length && (cur.length >= MAX_ROWS || bytes + size > MAX_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function DataBackup() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: BackupFile } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<Totals | null>(null);

  async function pick(f: File | undefined) {
    setResult(null);
    if (!f) return;
    try {
      const data: unknown = JSON.parse(await f.text());
      if (!isBackupFile(data)) throw new Error("not a backup");
      setFile({ name: f.name, data });
    } catch {
      setFile(null);
      toast.error("That is not a backup file exported from this app.");
    }
  }

  async function restore() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    const totals: Totals = {};
    try {
      let pending: { table: BackupTable; rows: Row[] }[] = RESTORABLE_TABLES.map((table) => ({ table, rows: (file.data.tables[table] ?? []) as Row[] })).filter((p) => p.rows.length);
      for (let pass = 1; pass <= 4 && pending.length; pass++) {
        const next: { table: BackupTable; rows: Row[] }[] = [];
        for (const { table, rows } of pending) {
          const retry: Row[] = [];
          const pieces = chunk(rows);
          for (let i = 0; i < pieces.length; i++) {
            setProgress(`${table} (${i + 1}/${pieces.length})${pass > 1 ? ` · round ${pass}` : ""}`);
            const r = await restoreRowsAction({ table, rows: pieces[i] });
            if (!r.ok || !r.data) throw new Error(r.ok ? "No answer from the server" : r.error);
            const t = (totals[table] ??= { inserted: 0, skipped: 0, failed: 0 });
            t.inserted += r.data.inserted;
            t.skipped += r.data.skipped;
            t.failed += r.data.errors.length;
            retry.push(...r.data.retry);
          }
          if (retry.length) next.push({ table, rows: retry });
        }
        pending = next;
      }
      for (const { table, rows } of pending) (totals[table] ??= { inserted: 0, skipped: 0, failed: 0 }).failed += rows.length;
      await finishRestoreAction({ fileDate: file.data.exported_at ?? null, totals });
      setResult(totals);
      const added = Object.values(totals).reduce((n, t) => n + t.inserted, 0);
      toast.success(added ? `Restored ${added} missing row(s). Nothing was deleted or changed.` : "Nothing was missing — your data already has everything in this file.");
    } catch (e) {
      setResult(totals);
      toast.error(e instanceof Error ? e.message : "Restore stopped. Run it again — rows already restored are skipped.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  const counts = file ? RESTORABLE_TABLES.map((t) => [t, file.data.tables[t]?.length ?? 0] as const).filter(([, n]) => n > 0) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Download className="size-4" /> Export all data
          </CardTitle>
          <CardDescription>
            One file with every customer, conversation, message, lead, booking, flow, setting and log. Read-only: nothing in the app changes. Saved CRM passwords and
            secrets are left out. Uploaded media files are not included, only their records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/api/export" download>
              <Download /> Download backup (.json)
            </a>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Large accounts take a little while to start. Keep the file somewhere private: it contains customer phone numbers and messages.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="size-4" /> Restore from a backup
          </CardTitle>
          <CardDescription>
            Upload a file you exported here. It only adds what is missing: existing rows are skipped, nothing is deleted and nothing is overwritten. Team accounts, queued jobs and CRM
            retries are not restored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <Upload /> Choose backup file
          </Button>
          {file && (
            <div className="space-y-3 rounded-2xl border p-3 text-sm">
              <div>
                <div className="font-medium break-all">{file.name}</div>
                <div className="text-xs text-muted-foreground">Exported {new Date(file.data.exported_at).toLocaleString()}</div>
              </div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {counts.map(([t, n]) => (
                  <li key={t} className="flex justify-between gap-2">
                    <span>{t.replaceAll("_", " ")}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
              </ul>
              <Button disabled={busy} onClick={() => void restore()}>
                {busy && <Loader2 className="animate-spin" />} {busy ? `Restoring ${progress}` : "Restore missing data"}
              </Button>
            </div>
          )}
          {result && (
            <ul className="space-y-1 rounded-2xl bg-muted p-3 text-xs">
              {Object.entries(result).map(([t, r]) => (
                <li key={t} className="flex justify-between gap-2">
                  <span>{t.replaceAll("_", " ")}</span>
                  <span className="tabular-nums">
                    {r.inserted} added · {r.skipped} already there{r.failed ? ` · ${r.failed} could not be restored` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
