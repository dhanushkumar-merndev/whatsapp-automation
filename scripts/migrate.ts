/**
 * Applies supabase/migrations/*.sql in order, once each.
 *   pnpm db:migrate            apply pending migrations
 *   pnpm db:migrate --status   list applied / pending
 *
 * Connection (first available):
 *   1. SUPABASE_DB_URL — direct Postgres connection string.
 *   2. Supabase Management API — SUPABASE_ACCESS_TOKEN (or the token saved by
 *      `supabase login` in ~/.supabase/access-token) + the project ref taken
 *      from NEXT_PUBLIC_SUPABASE_URL. No database password needed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { loadEnv } from "./_env";

loadEnv();

interface Executor {
  label: string;
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  close(): Promise<void>;
}

function pgExecutor(url: string): Executor {
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  return {
    label: "direct Postgres connection",
    async query<T>(text: string) {
      return (await sql.unsafe(text)) as unknown as T[];
    },
    close: () => sql.end(),
  };
}

function apiExecutor(token: string, ref: string): Executor {
  return {
    label: `Supabase Management API (project ${ref})`,
    async query<T>(text: string) {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const body = await res.text();
      if (!res.ok) {
        let message = body;
        try {
          message = JSON.parse(body).message ?? body;
        } catch {}
        throw new Error(`HTTP ${res.status}: ${message}`);
      }
      const parsed = body ? JSON.parse(body) : [];
      return (Array.isArray(parsed) ? parsed : []) as T[];
    },
    close: async () => {},
  };
}

function createExecutor(): Executor {
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (dbUrl) return pgExecutor(dbUrl);
  const tokenFile = path.join(homedir(), ".supabase", "access-token");
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() || (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");
  const ref =
    process.env.SUPABASE_PROJECT_REF?.trim() ||
    /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1];
  if (token && ref) return apiExecutor(token, ref);
  console.error(
    "✗ No database connection. Set SUPABASE_DB_URL, or run `npx supabase login` and set NEXT_PUBLIC_SUPABASE_URL.",
  );
  process.exit(1);
}

const dir = path.resolve("supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const statusOnly = process.argv.includes("--status");
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main(db: Executor) {
  console.log(`Using ${db.label}\n`);
  await db.query(`
    create schema if not exists sgh_private;
    revoke all on schema sgh_private from public;
    create table if not exists sgh_private.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );`);
  const rows = await db.query<{ name: string; checksum: string }>(`select name, checksum from sgh_private.schema_migrations`);
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));

  let ran = 0;
  for (const file of files) {
    const body = readFileSync(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const prev = applied.get(file);
    if (prev) {
      const note = prev === checksum ? "" : "  (⚠ file changed after it was applied — create a new migration instead)";
      console.log(`✓ ${file}${note}`);
      continue;
    }
    if (statusOnly) {
      console.log(`• ${file}  (pending)`);
      continue;
    }
    process.stdout.write(`→ ${file} … `);
    // One transaction per migration: either the whole file applies or nothing does.
    await db.query(
      `begin;\n${body}\n;insert into sgh_private.schema_migrations (name, checksum) values (${quote(file)}, ${quote(checksum)});\ncommit;`,
    );
    console.log("applied");
    ran++;
  }
  if (!statusOnly) console.log(ran ? `\n${ran} migration(s) applied.` : "\nDatabase is up to date.");
}

const db = createExecutor();
main(db)
  .catch((e) => {
    console.error(`\n✗ Migration failed: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
