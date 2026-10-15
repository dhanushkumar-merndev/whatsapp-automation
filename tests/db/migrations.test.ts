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

describe("fast turn", () => {
  const msg = (id: string, extra: Record<string, unknown> = {}) => ({
    phone_number_id: "pn1",
    waba_id: "waba",
    wa_id: "919800000777",
    profile_name: "Ravi",
    wa_message_id: id,
    type: "text",
    body: "Hi",
    payload: {},
    provider_timestamp: "2026-10-14T10:00:00Z",
    is_test: false,
    ...extra,
  });

  it("record_inbound_message resolves the account and reports what the webhook needs", async () => {
    const r = (await one<{ r: Record<string, unknown> }>(`select public.record_inbound_message($1) as r`, [msg("wamid.F1")])).r;
    expect(r.account_id).toBe(ACCOUNT);
    expect(r.conversation_status).toBe("open");
    expect(r.opted_out).toBe(false);
    expect(r.duplicate).toBe(false);
  });

  it("ignores unknown numbers, other WABAs and disabled accounts", async () => {
    const other = await one<{ r: Record<string, unknown> }>(`select public.record_inbound_message($1) as r`, [
      msg("wamid.F2", { phone_number_id: "nope" }),
    ]);
    const wrongWaba = await one<{ r: Record<string, unknown> }>(`select public.record_inbound_message($1) as r`, [
      msg("wamid.F3", { waba_id: "other" }),
    ]);
    expect(other.r.ignored).toBe("unknown_account");
    expect(wrongWaba.r.ignored).toBe("unknown_account");
    await db.query(`update public.whatsapp_accounts set enabled = false where id = $1`, [ACCOUNT]);
    const disabled = await one<{ r: Record<string, unknown> }>(`select public.record_inbound_message($1) as r`, [msg("wamid.F4")]);
    await db.query(`update public.whatsapp_accounts set enabled = true where id = $1`, [ACCOUNT]);
    expect(disabled.r.ignored).toBe("unknown_account");
  });

  it("marks numbers listed in settings as tests", async () => {
    await db.query(`update public.app_settings set settings = settings || '{"testPhoneNumbers":["919800000888"]}'::jsonb where id = 1`);
    const r = await one<{ r: Record<string, unknown> }>(`select public.record_inbound_message($1) as r`, [
      msg("wamid.F5", { wa_id: "919800000888" }),
    ]);
    expect(r.r.is_test).toBe(true);
  });

  it("begin_turn locks once and returns the pending messages with the turn state", async () => {
    const { r } = await one<{ r: { conversation_id: string } }>(`select public.record_inbound_message($1) as r`, [msg("wamid.F6")]);
    const conv = r.conversation_id;
    const a = "33333333-3333-4333-8333-333333333333";
    const b = "44444444-4444-4444-8444-444444444444";
    const first = (await one<{ t: Record<string, unknown> }>(`select public.begin_turn($1, $2, 30, 20) as t`, [conv, a])).t;
    expect(first.locked).toBe(true);
    expect((first.pending as { wa_message_id: string }[]).map((m) => m.wa_message_id)).toEqual(["wamid.F1", "wamid.F6"]);
    const state = first.state as { conversation: Record<string, unknown>; contact: Record<string, unknown>; active: unknown; candidates: unknown[] };
    expect(state.conversation.phone_number_id).toBe("pn1");
    expect(state.contact.wa_id).toBe("919800000777");
    expect(state.active).toBeNull();
    expect(state.candidates).toEqual([]);
    const second = (await one<{ t: Record<string, unknown> }>(`select public.begin_turn($1, $2, 30, 20) as t`, [conv, b])).t;
    expect(second).toEqual({ locked: false });
    await db.query(`select public.release_conversation_lock($1, $2)`, [conv, a]);
  });

  it("lists the live flow (and the test flow only for test conversations) as candidates", async () => {
    const live = await one<{ id: string }>(`insert into public.flows (name, status) values ('Live', 'active') returning id`);
    const lv = await one<{ id: string }>(
      `insert into public.flow_versions (flow_id, version, definition) values ($1, 1, '{"nodes":[],"edges":[]}') returning id`,
      [live.id],
    );
    await db.query(`update public.flows set published_version_id = $2 where id = $1`, [live.id, lv.id]);
    const conv = await one<{ id: string }>(
      `select cv.id from public.conversations cv join public.contacts c on c.id = cv.contact_id where c.wa_id = '919800000777'`,
    );
    const state = (await one<{ s: { candidates: { flow_id: string; version_id: string }[] } }>(
      `select public.conversation_turn_state($1) as s`,
      [conv.id],
    )).s;
    expect(state.candidates).toEqual([expect.objectContaining({ flow_id: live.id, version_id: lv.id })]);
    await db.query(`update public.flows set status = 'paused' where id = $1`, [live.id]);
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

describe("keep warm", () => {
  const configure = (url: string) =>
    asRole(db, "service_role", { role: "service_role" }, (tx) => tx.query<{ r: string }>(`select public.configure_keep_warm($1) as r`, [url]));

  it("only accepts an https site and is a no-op without pg_cron / pg_net", async () => {
    expect((await configure("http://localhost:3000")).rows[0].r).toBe("skipped");
    expect((await configure("https://evil.example.com/x?y")).rows[0].r).toBe("skipped");
    expect((await configure("https://app.example.com/")).rows[0].r).toBe("unavailable");
    expect((await one<{ n: number }>(`select count(*)::int as n from sgh_private.keep_warm`)).n).toBe(0);
  });

  it("can't be called by signed-in users", async () => {
    await expect(
      asRole(db, "authenticated", { sub: ADMIN, role: "authenticated", aal: "aal2" }, (tx) => tx.query(`select public.configure_keep_warm('https://x.example.com')`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("one live workflow", () => {
  const service = { role: "service_role" };
  async function publishedFlow(name: string) {
    const f = await one<{ id: string }>(`insert into public.flows (name) values ($1) returning id`, [name]);
    const v = await one<{ id: string }>(
      `insert into public.flow_versions (flow_id, version, definition) values ($1, 1, '{"nodes":[],"edges":[]}') returning id`,
      [f.id],
    );
    await db.query(`update public.flows set published_version_id = $2 where id = $1`, [f.id, v.id]);
    return f.id;
  }
  const status = async (id: string) => (await one<{ status: string }>(`select status from public.flows where id = $1`, [id])).status;
  const setStatus = (id: string, s: string) =>
    asRole(db, "service_role", service, (tx) => tx.query<{ r: string | null }>(`select public.set_flow_status($1, $2) as r`, [id, s]));

  it("making a workflow live pauses the previous live one", async () => {
    await db.query(`update public.flows set status = 'paused' where status in ('active', 'testing')`);
    const a = await publishedFlow("A");
    const b = await publishedFlow("B");
    await setStatus(a, "active");
    const r = await setStatus(b, "active");
    expect(r.rows[0].r).toBe(a);
    expect(await status(a)).toBe("paused");
    expect(await status(b)).toBe("active");
    // A separate test-number workflow can run alongside.
    await setStatus(a, "testing");
    expect(await status(a)).toBe("testing");
    expect(await status(b)).toBe("active");
  });

  it("never allows two live workflows, nor an unpublished one", async () => {
    const c = await one<{ id: string }>(`insert into public.flows (name) values ('C') returning id`);
    await expect(setStatus(c.id, "active")).rejects.toThrow(/Publish the workflow/);
    await expect(db.query(`update public.flows set status = 'active' where id = $1`, [c.id])).rejects.toThrow(/flows_one_live/);
  });

  it("only admins can change workflow status", async () => {
    const d = await publishedFlow("D");
    await expect(
      asRole(db, "authenticated", { sub: ADMIN, role: "authenticated", aal: "aal1" }, (tx) => tx.query(`select public.set_flow_status($1, 'active')`, [d])),
    ).rejects.toThrow(/not authorised/);
  });
});

describe("bookings", () => {
  it("book_slot respects capacity and does not double-book the same step", async () => {
    const conv = await one<{ id: string; contact_id: string }>(`select id, contact_id from public.conversations limit 1`);
    const base = { calendar: "main", contact_id: conv.contact_id, conversation_id: conv.id, starts_at: "2026-10-15T05:00:00Z", ends_at: "2026-10-15T05:30:00Z", capacity: 1 };
    const book = (extra: Record<string, unknown>) => one<{ r: { ok: boolean; id?: string; existing?: boolean; reason?: string } }>(`select public.book_slot($1) as r`, [{ ...base, ...extra }]);
    const a = await book({ node_id: "b1" });
    expect(a.r.ok).toBe(true);
    expect((await book({ node_id: "b2" })).r).toEqual({ ok: false, reason: "full" });
    // Two per slot allowed on another calendar.
    expect((await book({ calendar: "room2", capacity: 2, node_id: "x" })).r.ok).toBe(true);
    expect((await book({ calendar: "room2", capacity: 2, node_id: "y" })).r.ok).toBe(true);
    expect((await book({ calendar: "room2", capacity: 2, node_id: "z" })).r.ok).toBe(false);
    // Cancelling frees the slot.
    await db.query(`update public.bookings set status = 'cancelled' where id = $1`, [a.r.id]);
    expect((await book({ node_id: "b3" })).r.ok).toBe(true);
  });
});

describe("contact tags", () => {
  it("adds and removes tags without duplicates, and the turn state includes them", async () => {
    const conv = await one<{ id: string; contact_id: string }>(`select id, contact_id from public.conversations limit 1`);
    const tags = async (add: string[], remove: string[]) =>
      (await one<{ t: string[] }>(`select public.update_contact_tags($1, $2, $3) as t`, [conv.contact_id, add, remove])).t;
    expect(await tags(["web", "hot lead"], [])).toEqual(["hot lead", "web"]);
    expect(await tags(["web"], ["hot lead"])).toEqual(["web"]);
    const state = (await one<{ s: { contact: { tags: string[] } } }>(`select public.conversation_turn_state($1) as s`, [conv.id])).s;
    expect(state.contact.tags).toEqual(["web"]);
  });
});

describe("coexistence", () => {
  const echo = (id: string) => ({
    phone_number_id: "pn1",
    waba_id: "waba",
    wa_id: "919800000555",
    wa_message_id: id,
    type: "text",
    body: "From the phone",
    payload: {},
    provider_timestamp: "2026-10-14T10:05:00Z",
  });

  it("an echo from the phone app hands the chat over once and never opens the reply window", async () => {
    const first = (await one<{ r: Record<string, unknown> }>(`select public.record_business_echo($1) as r`, [echo("wamid.E1")])).r;
    expect(first).toMatchObject({ duplicate: false, took_over: true });
    const second = (await one<{ r: Record<string, unknown> }>(`select public.record_business_echo($1) as r`, [echo("wamid.E2")])).r;
    expect(second.took_over).toBe(false);
    const again = (await one<{ r: Record<string, unknown> }>(`select public.record_business_echo($1) as r`, [echo("wamid.E2")])).r;
    expect(again.duplicate).toBe(true);
    const c = await one<{ status: string; handoff_by: string; last_inbound_at: string | null }>(
      `select status, handoff_by, last_inbound_at from public.conversations where id = $1`,
      [first.conversation_id],
    );
    expect(c).toEqual({ status: "handoff", handoff_by: "business_app", last_inbound_at: null });
    const m = await one<{ source: string; direction: string }>(`select source, direction from public.messages where wa_message_id = 'wamid.E1'`);
    expect(m).toEqual({ source: "business_app", direction: "outbound" });
  });

  it("history is stored as already handled, and contact names reach new customers", async () => {
    const n = await one<{ n: number }>(`select public.record_history($1) as n`, [
      {
        phone_number_id: "pn1",
        waba_id: "waba",
        wa_id: "919800000666",
        messages: [
          { direction: "inbound", wa_message_id: "wamid.H1", type: "text", body: "old", payload: {}, provider_timestamp: "2026-09-01T10:00:00Z" },
          { direction: "outbound", wa_message_id: "wamid.H2", type: "text", body: "reply", payload: {}, provider_timestamp: "2026-09-01T10:01:00Z" },
        ],
      },
    ]);
    expect(n.n).toBe(2);
    const h = await one<{ processing_status: string; source: string }>(`select processing_status, source from public.messages where wa_message_id = 'wamid.H1'`);
    expect(h).toEqual({ processing_status: "ignored", source: "history" });

    await db.query(`select public.sync_business_contacts($1)`, [[{ wa_id: "919800000777", full_name: "Ravi M", action: "add" }, { wa_id: "919800000888", full_name: "New Person", action: "add" }]]);
    expect((await one<{ s: string }>(`select saved_name as s from public.contacts where wa_id = '919800000777'`)).s).toBe("Ravi M");
    await db.query(`select public.record_inbound_message($1)`, [{ phone_number_id: "pn1", waba_id: "waba", wa_id: "919800000888", wa_message_id: "wamid.N1", type: "text", body: "Hi", payload: {} }]);
    expect((await one<{ s: string }>(`select saved_name as s from public.contacts where wa_id = '919800000888'`)).s).toBe("New Person");
  });

  it("dashboard users can never read a number's access token", async () => {
    await db.query(`update public.whatsapp_accounts set access_token_encrypted = 'v1:secret' where id = $1`, [ACCOUNT]);
    const claims = { sub: ADMIN, role: "authenticated", aal: "aal2" };
    await expect(asRole(db, "authenticated", claims, (tx) => tx.query(`select access_token_encrypted from public.whatsapp_accounts`))).rejects.toThrow(/permission denied/);
    const ok = await asRole(db, "authenticated", claims, (tx) => tx.query<{ waba_id: string }>(`select waba_id from public.whatsapp_accounts`));
    expect(ok.rows[0].waba_id).toBe("waba");
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
