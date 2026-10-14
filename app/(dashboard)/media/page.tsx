import type { Metadata } from "next";
import { FileText, ImageIcon, Video } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { SourceBadge } from "@/components/common/source-badge";
import { Card, CardContent } from "@/components/ui/card";
import { MediaUploader } from "@/components/media/uploader";
import { MediaCardActions } from "@/components/media/media-card-actions";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { fmtAgo, fmtBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Media Library" };
const ICONS = { document: FileText, image: ImageIcon, video: Video } as const;

export default async function MediaPage() {
  await requirePageSession("admin");
  const supabase = await createClient();
  const [{ data: assets }, { data: storage }, { data: limit }] = await Promise.all([
    supabase.from("media_assets").select("id, name, kind, mime_type, size_bytes, created_at, meta_media_uploaded_at").eq("status", "ready").is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.rpc("get_storage_usage"),
    supabase.from("plan_limits").select("limit_value").eq("service", "supabase").eq("metric", "storage_bytes").eq("active", true).limit(1).maybeSingle(),
  ]);
  const used = Number((storage as { media_bytes?: number } | null)?.media_bytes ?? 0);
  const cap = limit?.limit_value ? Number(limit.limit_value) : null;
  const pct = cap ? used / cap : 0;

  return (
    <>
      <PageHeader
        title="Media Library"
        description="Private files for your flows. They are never public: WhatsApp receives them through a secure server-side upload."
        actions={<MediaUploader />}
      />
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="min-w-48 flex-1">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted-foreground">Storage used</span>
              <span className="tabular-nums">
                {fmtBytes(used)}
                {cap ? ` of ${fmtBytes(cap)}` : ""}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", pct >= 0.95 ? "bg-red-500" : pct >= 0.85 ? "bg-amber-500" : "bg-foreground")} style={{ width: `${Math.min(100, Math.max(pct * 100, 0.5))}%` }} />
            </div>
          </div>
          <SourceBadge source="measured" />
          {pct >= 0.85 && <p className="w-full text-xs text-amber-800">Storage is above 85% of the configured allowance. Delete unused files or upgrade your Supabase plan.</p>}
          <p className="w-full text-xs text-muted-foreground">Allowed: PDF (≤ 50 MB), JPG/PNG (≤ 5 MB), MP4/3GP video (≤ 16 MB).</p>
        </CardContent>
      </Card>
      {!assets?.length ? (
        <EmptyState icon={FileText} title="No files yet" description="Upload your company brochure (PDF) and select it in the flow's “Send media” step." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((a) => {
            const Icon = ICONS[a.kind as keyof typeof ICONS] ?? FileText;
            return (
              <Card key={a.id} className="gap-3 py-0">
                <a href={`/api/media/${a.id}/preview`} target="_blank" rel="noreferrer" className="flex h-36 items-center justify-center overflow-hidden rounded-t-2xl bg-muted">
                  {a.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${a.id}/preview`} alt={a.name} className="h-full w-full object-cover" />
                  ) : (
                    <Icon className="size-10 text-muted-foreground" strokeWidth={1.25} />
                  )}
                </a>
                <div className="flex items-start gap-2 px-4 pb-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" title={a.name}>
                      {a.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.kind} · {fmtBytes(a.size_bytes)} · {fmtAgo(a.created_at)}
                    </div>
                  </div>
                  <MediaCardActions id={a.id} name={a.name} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
