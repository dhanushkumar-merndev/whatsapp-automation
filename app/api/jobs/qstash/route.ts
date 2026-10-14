import type { NextRequest } from "next/server";
import { z } from "zod";
import { jobsEndpoint, verifyQStashSignature } from "@/lib/qstash";
import { handleScheduledJob } from "@/lib/core/jobs";
import { createPipelineDeps } from "@/lib/server/pipeline";
import { createLogger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger("jobs.qstash");
const bodySchema = z.object({ jobId: z.uuid() });

/** QStash delivers delayed flow steps and CRM retries here. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const valid = await verifyQStashSignature({ signature: req.headers.get("upstash-signature"), body: raw, url: jobsEndpoint() });
  if (!valid) {
    log.warn("rejected job with invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }
  const parsed = bodySchema.safeParse((() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })());
  // Malformed jobs are acknowledged so QStash does not retry them forever.
  if (!parsed.success) return Response.json({ ok: false, error: "invalid job body" });

  const retried = Number(req.headers.get("upstash-retried") ?? 0) || 0;
  const deps = await createPipelineDeps("jobs.qstash", { backgroundWrites: true });
  try {
    const outcome = await handleScheduledJob(deps, parsed.data.jobId, { retried });
    if (outcome.status === "retry") return new Response(outcome.detail, { status: 503 });
    return Response.json({ ok: true, ...outcome });
  } catch (e) {
    log.error("job failed", { jobId: parsed.data.jobId, error: e instanceof Error ? e.message : String(e) });
    return new Response("Job failed", { status: 500 });
  } finally {
    await deps.store.flush();
  }
}
