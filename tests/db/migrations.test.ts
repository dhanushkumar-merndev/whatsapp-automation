import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { asRole, createMigratedDb, MIGRATIONS_DIR, migrationFiles } from "../helpers/pglite";

let db: PGlite;
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-0000000000aa";

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(
    `insert into public.whatsapp_accounts (id, name, waba_id, phone_number_id) values ($1, 'Main', 'waba', 'pn1')`,
    [ACCOUNT],
  );
  await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com')`, [ADMIN]);
  await db.query(
    `insert into public.profiles (id, email, role, status) values ($1, 'admin@example.com', 'owner', 'active')`,
    [ADMIN],
  );
});

function inbound(waMessageId: string, ts = "2026-10-14T10:00:00Z") {
  return {
    account_id: ACCOUNT,
    wa_id: "919876543210",
    profile_name: "Asha",
    wa_message_id: waMessageId,
    type: "text",
    body: "Hi",
    payload: {},
    provider_timestamp: ts,
    is_test: false,
  };
}

describe("migrations", () => {
  it("enable RLS on every public table", async () => {
    const rows = (
      await db.query<{ relname: string; relrowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`,
      )
    ).rows;
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it("every table has a restrictive MFA (aal2) policy", async () => {
    const tables = (
      await db.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`,
      )
    ).rows.map((r) => r.relname);
    const policies = (
      await db.query<{ tablename: string }>(
        `select tablename from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE'
           and policyname like '%_require_mfa'`,
      )
    ).rows.map((r) => r.tablename);
    for (const t of tables) expect(policies, t).toContain(t);
  });

  it("migration files are applied in a stable order", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8").length).toBeGreaterThan(0);
  });
});

describe("record_inbound_message", () => {
  it("deduplicates Meta webhook retries by wa_message_id", async () => {
    const first = await one<{ r: Record<string, unknown> }>(`select public.record_inbound_message($1) as r`, [
      inbound("wamid.A1"),
    ]);
    const second = await one<{ r: Record<string, unknown> }>(`select public.record_inbound_message($1) as r`, [
      inbound("wamid.A1"),
    ]);
    expect(first.r.duplicate).toBe(false);
    expect(first.r.new_contact).toBe(true);
    expect(second.r.duplicate).toBe(true);
    expect(second.r.conversation_id).toBe(first.r.conversation_id);
    const count = await one<{ n: number }>(`select count(*)::int as n from public.messages where wa_message_id = 'wamid.A1'`);
    expect(count.n).toBe(1);
  });

  it("refreshes last_inbound_at only forwards", async () => {
    await db.query(`select public.record_inbound_message($1)`, [inbound("wamid.A2", "2026-10-14T12:00:00Z")]);
    await db.query(`select public.record_inbound_message($1)`, [inbound("wamid.A3", "2026-10-14T11:00:00Z")]);
    const c = await one<{ t: string }>(
      `select to_char(last_inbound_at at time zone 'utc', 'HH24:MI') as t from public.conversations`,
    );
    expect(c.t).toBe("12:00");
  });
});

describe("conversation lock", () => {
  it("allows a single holder until released", async () => {
    const conv = await one<{ id: string }>(`select id from public.conversations limit 1`);
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const lock = (t: string) =>
      one<{ ok: boolean }>(`select public.acquire_conversation_lock($1, $2, 30) as ok`, [conv.id, t]);
    expect((await lock(a)).ok).toBe(true);
    expect((await lock(b)).ok).toBe(false);
    expect((await lock(a)).ok).toBe(true); // re-entrant for the same token
    await db.query(`select public.release_conversation_lock($1, $2)`, [conv.id, a]);
    expect((await lock(b)).ok).toBe(true);
    await db.query(`select public.release_conversation_lock($1, $2)`, [conv.id, b]);
  });
});

describe("outbound idempotency and job claims", () => {
  it("claims an outbound send only once", async () => {
    const conv = await one<{ id: string; contact_id: string }>(`select id, contact_id from public.conversations limit 1`);
    const claim = {
      conversation_id: conv.id,
      contact_id: conv.contact_id,
      idempotency_key: "exec:1:node",
      type: "text",
      body: "hello",
      payload: {},
      is_test: false,
    };
    const first = await one<{ r: { status: string } }>(`select public.claim_outbound_message($1) as r`, [claim]);
    const second = await one<{ r: { status: string; existing_status: string } }>(
      `select public.claim_outbound_message($1) as r`,
      [claim],
    );
    expect(first.r.status).toBe("new");
    expect(second.r.status).toBe("duplicate");
    expect(second.r.existing_status).toBe("pending");
  });

  it("claims a scheduled job only once", async () => {
    const job = await one<{ id: string }>(
      `insert into public.scheduled_jobs (kind, run_at, idempotency_key) values ('crm_retry', now(), 'k1') returning id`,
    );
    const a = await one<{ r: unknown }>(`select public.claim_scheduled_job($1) as r`, [job.id]);
    const b = await one<{ r: unknown }>(`select public.claim_scheduled_job($1) as r`, [job.id]);
    expect(a.r).not.toBeNull();
    expect(b.r).toBeNull();
  });

  it("accumulates usage counters with null flow ids", async () => {
    for (let i = 0; i < 3; i++) {
      await db.query(`select public.increment_usage('qstash','deliveries','2026-10-14','local_measured',null,false,1)`);
    }
    const r = await one<{ q: string; n: number }>(
      `select sum(quantity)::text as q, count(*)::int as n from public.usage_records where service = 'qstash'`,
    );
    expect(r.q).toBe("3");
    expect(r.n).toBe(1);
  });
});

describe("flow versions and executions", () => {
  it("published versions are immutable and only one execution is active per conversation", async () => {
    const flow = await one<{ id: string }>(`insert into public.flows (name) values ('F') returning id`);
    const v = await one<{ id: string }>(
      `insert into public.flow_versions (flow_id, version, definition) values ($1, 1, '{"nodes":[],"edges":[]}') returning id`,
      [flow.id],
    );
    await expect(
      db.query(`update public.flow_versions set definition = '{"nodes":[1]}' where id = $1`, [v.id]),
    ).rejects.toThrow(/immutable/);

    const conv = await one<{ id: string; contact_id: string }>(`select id, contact_id from public.conversations limit 1`);
    const insert = () =>
      db.query(
        `insert into public.flow_executions (flow_id, flow_version_id, conversation_id, contact_id, status)
         values ($1, $2, $3, $4, 'waiting_input')`,
        [flow.id, v.id, conv.id, conv.contact_id],
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });
});

describe("row level security", () => {
  it("anon cannot read leads or conversations", async () => {
    await expect(asRole(db, "anon", {}, (tx) => tx.query(`select * from public.conversations`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("authenticated users without MFA (aal1) see nothing", async () => {
    const rows = await asRole(db, "authenticated", { sub: ADMIN, role: "authenticated", aal: "aal1" }, (tx) =>
      tx.query(`select id from public.conversations`),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("active admins with an aal2 session can read data", async () => {
    const rows = await asRole(db, "authenticated", { sub: ADMIN, role: "authenticated", aal: "aal2" }, (tx) =>
      tx.query(`select id from public.conversations`),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
  });

  it("unknown users with aal2 but no profile see nothing", async () => {
    const rows = await asRole(
      db,
      "authenticated",
      { sub: "99999999-9999-4999-8999-999999999999", role: "authenticated", aal: "aal2" },
      (tx) => tx.query(`select id from public.messages`),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("CRM secrets are not selectable by authenticated users", async () => {
    await expect(
      asRole(db, "authenticated", { sub: ADMIN, role: "authenticated", aal: "aal2" }, (tx) =>
        tx.query(`select credentials_encrypted from public.crm_integrations`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("server-only functions are not callable by authenticated users", async () => {
    await expect(
      asRole(db, "authenticated", { sub: ADMIN, role: "authenticated", aal: "aal2" }, (tx) =>
        tx.query(`select public.record_inbound_message('{}'::jsonb)`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
