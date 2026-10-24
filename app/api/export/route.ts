import { AuthzError, audit, requireAdmin } from "@/lib/auth/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_FORMAT, BACKUP_TABLES, BACKUP_VERSION, OMIT_COLUMNS, pkOf } from "@/lib/data-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 1000;

/** Everything in the database as one JSON file, streamed table by table. Owners only. Read-only. */
export async function GET() {
  let session;
  try {
    session = await requireAdmin({ role: "owner", limit: { prefix: "data_export", tokens: 5, windowSeconds: 3600 } });
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 401;
    return Response.json({ error: e instanceof Error ? e.message : "Unauthorized" }, { status });
  }

  const db = createAdminClient();
  const enc = new TextEncoder();
  const counts: Record<string, number> = {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(`{"format":"${BACKUP_FORMAT}","version":${BACKUP_VERSION},"exported_at":"${new Date().toISOString()}","tables":{`));
        let firstTable = true;
        for (const table of BACKUP_TABLES) {
          controller.enqueue(enc.encode(`${firstTable ? "" : ","}${JSON.stringify(table)}:[`));
          firstTable = false;
          let first = true;
          let total = 0;
          const omit = OMIT_COLUMNS[table] ?? [];
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await db.from(table).select("*").order(pkOf(table), { ascending: true }).range(from, from + PAGE - 1);
            if (error) throw new Error(`${table}: ${error.message}`);
            const chunk = (data ?? []).map((row: Record<string, unknown>) => {
              for (const c of omit) delete row[c];
              return JSON.stringify(row);
            });
            if (chunk.length) {
              controller.enqueue(enc.encode(`${first ? "" : ","}${chunk.join(",")}`));
              first = false;
              total += chunk.length;
            }
            if ((data?.length ?? 0) < PAGE) break;
          }
          counts[table] = total;
          controller.enqueue(enc.encode("]"));
        }
        controller.enqueue(enc.encode("}}"));
        controller.close();
        await audit(session, "data.exported", { type: "database" }, { rows: counts });
      } catch (e) {
        console.error("[export] failed", e instanceof Error ? e.message : e);
        controller.error(e);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sgh-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
