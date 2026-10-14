"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FastForward, FlaskConical, Paperclip, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MemoryStore } from "@/lib/core/memory-store";
import { FakeCrm, RecordingScheduler, RecordingSender } from "@/lib/core/fakes";
import { processConversation, type PipelineDeps } from "@/lib/core/process-conversation";
import { handleScheduledJob } from "@/lib/core/jobs";
import type { FlowDefinition } from "@/lib/engine/schema";
import type { OutboundMessage } from "@/lib/engine/types";
import type { AppSettings } from "@/lib/settings/schema";
import { cn } from "@/lib/utils";
import type { MediaOption } from "./editor-context";

interface Sim {
  store: MemoryStore;
  sender: RecordingSender;
  scheduler: RecordingScheduler;
  crm: FakeCrm;
  deps: PipelineDeps;
  clock: { t: number };
  accountId: string;
  ran: Set<string>;
  seq: number;
}

const CUSTOMER = "919800000000";

function createSim(definition: FlowDefinition, settings: AppSettings, media: MediaOption[], crmFails: boolean): Sim {
  const clock = { t: Date.now() };
  const now = () => new Date(clock.t);
  const store = new MemoryStore(now);
  const account = store.addAccount({ phoneNumberId: "SIM", wabaId: "SIM" });
  for (const m of media) {
    store.media.set(m.id, {
      id: m.id,
      name: m.name,
      kind: m.kind,
      mimeType: "application/octet-stream",
      sizeBytes: 0,
      storagePath: "sim",
      status: "ready",
      metaMediaId: null,
      metaMediaUploadedAt: null,
      metaPhoneNumberId: null,
      deletedAt: null,
    });
  }
  store.addFlow({ name: "Simulation", status: "active", definition });
  store.addCrmIntegration({ url: "https://crm.simulation.invalid", name: "Simulated CRM" });
  const sender = new RecordingSender();
  const scheduler = new RecordingScheduler();
  const crm = new FakeCrm();
  if (crmFails) {
    for (let i = 0; i < 10; i++) {
      crm.responses.push({ ok: false, statusCode: 503, error: "Simulated CRM outage", responseExcerpt: null, durationMs: 1, retryable: true });
    }
  }
  const deps: PipelineDeps = {
    store,
    sender,
    scheduler,
    crm,
    // The simulator never touches Redis.
    limiter: { limit: async () => ({ success: true, remaining: 99, reset: 0 }) },
    settings: { ...settings, usage: { ...settings.usage, hardCapEnabled: false } },
    now,
    logger: { info() {}, warn() {}, error() {} },
    mode: "simulation",
  };
  return { store, sender, scheduler, crm, deps, clock, accountId: account.id, ran: new Set(), seq: 0 };
}

function OutboundBubble({ m, onPick }: { m: OutboundMessage; onPick: (id: string, title: string) => void }) {
  if (m.kind === "text") return <div className="whitespace-pre-wrap">{m.text}</div>;
  if (m.kind === "media") {
    return (
      <div>
        <div className="flex items-center gap-1.5 font-medium">
          <Paperclip className="size-3.5" /> {m.filename ?? m.mediaType}
        </div>
        {m.caption && <div className="mt-1 whitespace-pre-wrap">{m.caption}</div>}
      </div>
    );
  }
  const options = m.kind === "buttons" ? m.buttons : m.rows;
  return (
    <div>
      {m.header && <div className="font-semibold">{m.header}</div>}
      <div className="whitespace-pre-wrap">{m.body}</div>
      {m.footer && <div className="mt-1 text-[11px] text-muted-foreground">{m.footer}</div>}
      <div className="mt-2 flex flex-col gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onPick(o.id, o.title)}
            className="rounded-md border border-success/30 bg-white px-2 py-1 text-left text-xs text-success hover:bg-success/10 dark:bg-transparent"
          >
            {o.title}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SimView {
  startedWithKey: string | null;
  messages: MemoryStore["messages"];
  outboundSent: number;
  qstash: number;
  status: string | null;
  pendingDelaySeconds: number | null;
  pendingCrmJobs: number;
  lead: { status: string; name: string | null; service: string | null; businessName: string | null; crmSyncStatus: string } | null;
}

const EMPTY_VIEW: SimView = {
  startedWithKey: null,
  messages: [],
  outboundSent: 0,
  qstash: 0,
  status: null,
  pendingDelaySeconds: null,
  pendingCrmJobs: 0,
  lead: null,
};

function snapshot(sim: Sim, key: string): SimView {
  const execution = [...sim.store.executions.values()].filter((e) => e.conversationId !== "prior").at(-1);
  const unrun = sim.scheduler.scheduled.filter((s) => !sim.ran.has(s.jobId) && sim.store.jobs.get(s.jobId)?.status === "scheduled");
  const delay = execution?.status === "waiting_delay" ? unrun.find((s) => sim.store.jobs.get(s.jobId)?.kind === "flow_resume") : undefined;
  const lead = [...sim.store.leads.values()].at(-1);
  return {
    startedWithKey: key,
    messages: sim.store.messages.map((m) => ({ ...m })),
    outboundSent: sim.sender.sent.length,
    qstash: sim.scheduler.scheduled.length,
    status: execution?.status ?? null,
    pendingDelaySeconds: delay ? delay.delaySeconds : null,
    pendingCrmJobs: unrun.filter((s) => sim.store.jobs.get(s.jobId)?.kind === "crm_retry").length,
    lead: lead
      ? { status: lead.status, name: lead.name, service: lead.service, businessName: lead.businessName, crmSyncStatus: lead.crmSyncStatus }
      : null,
  };
}

export function Simulator({
  definition,
  settings,
  media,
  onPath,
}: {
  definition: FlowDefinition;
  settings: AppSettings;
  media: MediaOption[];
  onPath: (path: { visited: string[]; current: string | null } | null) => void;
}) {
  const [crmFails, setCrmFails] = useState(false);
  const [returning, setReturning] = useState(false);
  const simRef = useRef<Sim | null>(null);
  const [view, setView] = useState<SimView>(EMPTY_VIEW);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const definitionKey = useMemo(() => JSON.stringify(definition), [definition]);
  const stale = view.startedWithKey !== null && view.startedWithKey !== definitionKey;

  useEffect(() => () => onPath(null), [onPath]);

  const ensureSim = useCallback(() => {
    if (!simRef.current) simRef.current = createSim(definition, settings, media, crmFails);
    return simRef.current;
  }, [definition, settings, media, crmFails]);

  const reset = useCallback(() => {
    simRef.current = createSim(definition, settings, media, crmFails);
    setView({ ...EMPTY_VIEW, startedWithKey: definitionKey });
    onPath(null);
  }, [definition, settings, media, crmFails, definitionKey, onPath]);

  const refresh = useCallback(
    (sim: Sim) => {
      const v = snapshot(sim, view.startedWithKey ?? definitionKey);
      setView(v);
      const ex = [...sim.store.executions.values()].filter((e) => e.conversationId !== "prior").at(-1);
      onPath(ex ? { visited: ex.context.path, current: ["waiting_input", "waiting_delay"].includes(ex.status) ? ex.currentNodeId : null } : null);
    },
    [onPath, view.startedWithKey, definitionKey],
  );

  const send = async (input: { text: string; replyId?: string; replyTitle?: string }) => {
    if (busy) return;
    const s = ensureSim();
    setBusy(true);
    try {
      s.clock.t += 1000;
      const r = await s.store.recordInbound({
        accountId: s.accountId,
        waId: CUSTOMER,
        profileName: "Test Customer",
        waMessageId: `wamid.sim.in.${++s.seq}`,
        type: input.replyId ? "interactive" : "text",
        body: input.replyTitle ?? input.text,
        payload: input.replyId ? { reply_id: input.replyId, reply_title: input.replyTitle } : {},
        providerTimestamp: new Date(s.clock.t).toISOString(),
        isTest: true,
      });
      if (returning && r.newContact) {
        await s.store.updateContact(r.contactId, { name: "Test Customer" });
        const flow = [...s.store.flows.values()][0];
        s.store.seedPriorExecution(r.contactId, "prior", flow.id, flow.publishedVersionId!);
      }
      await processConversation(s.deps, r.conversationId);
    } finally {
      setBusy(false);
      refresh(s);
    }
  };

  const fastForward = async () => {
    const s = simRef.current;
    if (!s) return;
    setBusy(true);
    try {
      for (const j of s.scheduler.scheduled.filter((x) => !s.ran.has(x.jobId))) {
        const job = s.store.jobs.get(j.jobId);
        if (!job) continue;
        s.clock.t = Math.max(s.clock.t, new Date(job.runAt).getTime());
        s.ran.add(j.jobId);
        await handleScheduledJob(s.deps, j.jobId, { retried: 0, lockWaitMs: 0 });
      }
    } finally {
      setBusy(false);
      refresh(s);
    }
  };

  const messages = view.messages.filter((m) => m.conversationId !== "prior");

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <FlaskConical className="size-4" /> Simulator
          </div>
          <Button variant="outline" size="xs" onClick={reset}>
            <RotateCcw /> Restart
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Runs this draft with the real engine in your browser. No WhatsApp messages are sent, no leads are created and
          no usage is recorded.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <label className="flex items-center gap-1.5">
            <Switch checked={returning} onCheckedChange={(v) => setReturning(v)} className="scale-75" /> Returning customer
          </label>
          <label className="flex items-center gap-1.5">
            <Switch checked={crmFails} onCheckedChange={(v) => setCrmFails(v)} className="scale-75" /> CRM outage
          </label>
        </div>
        {stale && (
          <button type="button" onClick={reset} className="w-full rounded-xl bg-warning/10 px-3 py-2 text-left text-xs text-warning">
            The flow changed since this simulation started — click to restart with the latest draft.
          </button>
        )}
      </div>
      {/* WhatsApp chat colours, light and dark. */}
      <ScrollArea className="min-h-0 flex-1 bg-[#efeae2] dark:bg-[#0b141a]">
        <div className="space-y-2 p-3">
          {messages.length === 0 && (
            <p className="rounded-md bg-white/80 p-2 text-center text-xs text-muted-foreground dark:bg-[#202c33]/80">
              Send a message as the customer (e.g. “Hi”). The bot never writes first.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.direction === "inbound" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13px] shadow-sm",
                  m.direction === "inbound" ? "bg-[#d9fdd3] dark:bg-[#005c4b]" : "bg-white dark:bg-[#202c33]",
                  m.status === "failed" && "ring-1 ring-destructive/40",
                )}
              >
                {m.direction === "outbound" ? (
                  <OutboundBubble m={m.payload as OutboundMessage} onPick={(id, title) => void send({ text: title, replyId: id, replyTitle: title })} />
                ) : (
                  <div className="whitespace-pre-wrap">{m.body}</div>
                )}
                {m.processingNote && m.direction === "inbound" && !["answer", "flow_started"].includes(m.processingNote) && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{m.processingNote.replace(/_/g, " ")}</div>
                )}
              </div>
            </div>
          ))}
          {view.pendingDelaySeconds !== null && (
            <div className="flex justify-center">
              <Button size="xs" variant="secondary" onClick={fastForward} disabled={busy}>
                <FastForward /> Skip delay ({view.pendingDelaySeconds}s via QStash)
              </Button>
            </div>
          )}
          {view.pendingDelaySeconds === null && view.pendingCrmJobs > 0 && (
            <div className="flex justify-center">
              <Button size="xs" variant="secondary" onClick={fastForward} disabled={busy}>
                <FastForward /> Run {view.pendingCrmJobs} CRM retry job(s)
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="border-t p-2">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            const t = text;
            setText("");
            void send({ text: t });
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message as the customer…" className="h-9 rounded-full px-4 text-sm" />
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send">
            <Send />
          </Button>
        </form>
        <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px] text-muted-foreground">
          <div>
            <div className="text-sm font-semibold text-foreground tabular-nums">{view.outboundSent}</div>replies
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground tabular-nums">{view.qstash}</div>QStash deliveries
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{view.status?.replace(/_/g, " ") ?? "idle"}</div>status
          </div>
        </div>
        {view.lead && (
          <div className="mt-2 rounded-md bg-muted p-2 text-[11px]">
            <span className="font-medium">Lead ({view.lead.status}):</span> {view.lead.name ?? "—"} · {view.lead.service ?? "—"} ·{" "}
            {view.lead.businessName ?? "—"} · CRM {view.lead.crmSyncStatus}
          </div>
        )}
      </div>
    </div>
  );
}
