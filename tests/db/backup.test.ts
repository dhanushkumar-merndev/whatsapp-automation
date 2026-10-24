import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb, asRole } from "../helpers/pglite";
import { BACKUP_TABLES, RESTORABLE_TABLES, pkOf } from "@/lib/data-backup";

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDb();
});

const CONTACT = "00000000-0000-4000-8000-0000000000c1";
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const CONV = "00000000-0000-4000-8000-0000000000d1";

async function restore(table: string, rows: unknown[]) {
  const r = await db.query<{ r: { inserted: number; skipped: number; retry: unknown[]; errors: string[] } }>(
    `select public.restore_rows($1, $2::jsonb) as r`,
    [table, JSON.stringify(rows)],
  );
  return r.rows[0].r;
}

describe("backup", () => {
  it("lists every table in the public schema (a new table must be added to the export or consciously left out)", async () => {
    const r = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const missing = r.rows.map((x) => x.table_name).filter((t) => !(BACKUP_TABLES as readonly string[]).includes(t));
    expect(missing).toEqual([]);
  });

  it("uses a real primary-key column for every exported table", async () => {
    for (const t of BACKUP_TABLES) {
      const r = await db.query(`select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [t, pkOf(t)]);
      expect(r.rows.length, `${t}.${pkOf(t)}`).toBe(1);
    }
  });

  it("restore adds missing rows, skips existing ones, never overwrites, and hands back rows whose parent is missing", async () => {
    await db.query(`insert into public.whatsapp_accounts (id, name, waba_id, phone_number_id) values ($1, 'Main', 'w', 'pn')`, [ACCOUNT]);
    await db.query(`insert into public.contacts (id, wa_id, name) values ($1, '919876543210', 'Original')`, [CONTACT]);
    await db.query(`insert into public.conversations (id, contact_id, account_id) values ($1, $2, $3)`, [CONV, CONTACT, ACCOUNT]);
    // what an export file holds: whole rows
    const contact = (await db.query<{ j: Record<string, unknown> }>(`select to_jsonb(c) as j from public.contacts c`)).rows[0].j;
    const conv = (await db.query<{ j: Record<string, unknown> }>(`select to_jsonb(c) as j from public.conversations c`)).rows[0].j;

    // simulate lost data (test database only)
    await db.query(`delete from public.contacts`);

    // child before parent → asked to retry; nothing is written
    const first = await restore("conversations", [conv]);
    expect(first.errors, JSON.stringify(first)).toEqual([]);
    expect(first.retry).toHaveLength(1);
    expect(await restore("contacts", [contact])).toMatchObject({ inserted: 1, skipped: 0 });
    expect(await restore("conversations", [conv])).toMatchObject({ inserted: 1, retry: [] });

    // second run: everything exists → skipped; an edited copy of a row does not overwrite the live one
    expect(await restore("contacts", [{ ...contact, name: "Changed in the file" }])).toMatchObject({ inserted: 0, skipped: 1 });
    const live = await db.query<{ name: string }>(`select name from public.contacts where id = $1`, [CONTACT]);
    expect(live.rows[0].name).toBe("Original");
  });

  it("restores identity-keyed rows and moves the counter past them", async () => {
    const r = await restore("audit_logs", [{ id: 500, actor_type: "system", action: "x", created_at: "2026-10-01T00:00:00Z" }]);
    expect(r.inserted).toBe(1);
    await db.query(`insert into public.audit_logs (actor_type, action) values ('system', 'later')`);
    const max = await db.query<{ id: string }>(`select max(id)::text as id from public.audit_logs`);
    expect(Number(max.rows[0].id)).toBeGreaterThan(500);
  });

  it("refuses tables that are export-only and cannot be called by signed-in users", async () => {
    await expect(restore("profiles", [])).rejects.toThrow(/cannot be restored/);
    expect(RESTORABLE_TABLES).not.toContain("profiles");
    await expect(
      asRole(db, "authenticated", { sub: "x", role: "authenticated", aal: "aal2" }, (tx) => tx.query(`select public.restore_rows('contacts', '[]'::jsonb)`)),
    ).rejects.toThrow(/permission denied/);
  });
});
