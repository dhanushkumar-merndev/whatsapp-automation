/**
 * Applies supabase/migrations/*.sql to SUPABASE_DB_URL in order, once each.
 *   pnpm db:migrate            apply pending migrations
 *   pnpm db:migrate --status   list applied / pending
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { loadEnv, required } from "./_env";

loadEnv();
const dir = path.resolve("supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const statusOnly = process.argv.includes("--status");

const sql = postgres(required("SUPABASE_DB_URL"), { max: 1, onnotice: () => {}, prepare: false });

async function main() {
  await sql.unsafe(`
    create schema if not exists sgh_private;
    revoke all on schema sgh_private from public;
    create table if not exists sgh_private.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );`);
  const applied = new Map(
    (await sql<{ name: string; checksum: string }[]>`select name, checksum from sgh_private.schema_migrations`).map((r) => [
      r.name,
      r.checksum,
    ]),
  );

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
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into sgh_private.schema_migrations (name, checksum) values (${file}, ${checksum})`;
    });
    console.log("applied");
    ran++;
  }
  console.log(statusOnly ? "" : ran ? `\n${ran} migration(s) applied.` : "\nDatabase is up to date.");
}

main()
  .catch((e) => {
    console.error(`\n✗ Migration failed: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
