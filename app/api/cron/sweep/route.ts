import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createPipelineDeps } from "@/lib/server/pipeline";
import { runSweep } from "@/lib/server/sweep";
import { createLogger } from "@/lib/server/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger("cron.sweep");

function authorised(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv().CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Daily maintenance, invoked by Vercel Cron (see vercel.json). */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  try {
    const report = await runSweep(await createPipelineDeps("cron.sweep"));
    await createAdminClient().from("audit_logs").insert({ actor_type: "system", action: "cron.sweep", detail: report });
    log.info("sweep finished", report);
    return Response.json({ ok: true, report });
  } catch (e) {
    log.error("sweep failed", { error: e instanceof Error ? e.message : String(e) });
    return new Response("Sweep failed", { status: 500 });
  }
}
