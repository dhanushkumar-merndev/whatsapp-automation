import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Card } from "@/components/ui/card";
import { requirePageSession } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings/server";
import { isWindowOpen } from "@/lib/engine/window";
import { fmtAgo, fmtPhone } from "@/lib/format";
import { hoursAgoIso } from "@/lib/server/metrics";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversations" };

const VIEWS = {
  all: "All",
  handoff: "Needs reply",
  open: "Window open",
  test: "Test numbers",
  closed: "Closed",
} as const;
type View = keyof typeof VIEWS;

export default async function ConversationsPage({ searchParams }: PageProps<"/conversations">) {
  await requirePageSession("staff");
  const sp = await searchParams;
  const view = (typeof sp.view === "string" && sp.view in VIEWS ? sp.view : "all") as View;
  const q = typeof sp.q === "string" ? sp.q.replace(/[%,()]/g, "").slice(0, 60) : "";
  const supabase = await createClient();
  const settings = await loadSettings();

  let query = supabase
    .from("conversations")
    .select("id, status, last_inbound_at, last_outbound_at, is_test, handoff_reason, contacts!inner(id, wa_id, name, profile_name, opted_out)")
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (view === "handoff") query = query.eq("status", "handoff");
  if (view === "closed") query = query.eq("status", "closed");
  if (view === "test") query = query.eq("is_test", true);
  if (view === "open") query = query.gte("last_inbound_at", hoursAgoIso(24));
  if (view !== "test") query = query.eq("is_test", false);
  if (q) query = query.or(`name.ilike.%${q}%,profile_name.ilike.%${q}%,wa_id.ilike.%${q.replace(/\D/g, "") || q}%`, { referencedTable: "contacts" });
  const { data: conversations, error } = await query;

  const ids = (conversations ?? []).map((c) => c.id);
  const { data: lastMessages } = ids.length
    ? await supabase.from("messages").select("conversation_id, body, direction, created_at").in("conversation_id", ids).order("created_at", { ascending: false }).limit(400)
    : { data: [] };
  const latest = new Map<string, { body: string | null; direction: string }>();
  for (const m of lastMessages ?? []) if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, m);

  return (
    <>
      <PageHeader title="Conversations" description="Customer-initiated WhatsApp conversations. You can reply manually while the 24-hour window is open." />
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={`/conversations${v === "all" ? "" : `?view=${v}`}`}
            className={cn("rounded-full border px-3 py-1 text-xs", view === v ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            {VIEWS[v]}
          </Link>
        ))}
        <form className="ml-auto">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <input name="q" defaultValue={q} placeholder="Search name or number" className="h-9 w-56 rounded-full border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
        </form>
      </div>
      {error && <p className="mb-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error.message}</p>}
      {!conversations?.length ? (
        <EmptyState icon={MessagesSquare} title="No conversations" description="Conversations start when a customer messages your WhatsApp number." />
      ) : (
        <Card className="py-0">
          <ul className="divide-y">
            {conversations.map((c) => {
              const contact = (Array.isArray(c.contacts) ? c.contacts[0] : c.contacts) as { wa_id: string; name: string | null; profile_name: string | null; opted_out: boolean };
              const last = latest.get(c.id);
              const open = isWindowOpen(c.last_inbound_at, new Date(), settings);
              return (
                <li key={c.id}>
                  <Link href={`/conversations/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                      {(contact.name ?? contact.profile_name ?? "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{contact.name ?? contact.profile_name ?? fmtPhone(contact.wa_id)}</span>
                        <span className="text-xs text-muted-foreground">{fmtPhone(contact.wa_id)}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {last ? `${last.direction === "outbound" ? "You: " : ""}${last.body ?? "[media]"}` : "No messages"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {contact.opted_out && <StatusBadge status="opted out" tone="red" />}
                      {c.status !== "open" && <StatusBadge status={c.status} />}
                      {open ? <StatusBadge status="window open" tone="green" /> : <StatusBadge status="window closed" tone="gray" />}
                      <span className="w-20 text-right text-xs text-muted-foreground">{fmtAgo(c.last_inbound_at)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
