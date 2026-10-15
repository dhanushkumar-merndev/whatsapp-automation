"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findTelegramChatsAction, sendTelegramTestAction, updateSettingsAction } from "@/app/(dashboard)/settings/actions";
import type { AppSettings } from "@/lib/settings/schema";
import { cn } from "@/lib/utils";

const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function Num({ label, value, onChange, help }: { label: string; value: number; onChange: (n: number) => void; help?: string }) {
  // Keep what is typed (even an empty box) and only commit the number on blur.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    onChange(Number(draft) || 0);
    setDraft(null);
  };
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode="decimal"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.-]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
    </div>
  );
}

const TELEGRAM_EVENTS: { key: keyof AppSettings["telegram"]["events"]; label: string; help: string }[] = [
  { key: "handoff", label: "Human help needed", help: "Customer typed HUMAN or could not finish the questions." },
  { key: "handoffMessages", label: "Customer replies to your team", help: "Every message from a customer whose chat is with your team." },
  { key: "leads", label: "New leads", help: "Name, phone, service, business and requirements when an enquiry is submitted." },
  { key: "bookings", label: "New bookings", help: "Who booked, for what, and when." },
  { key: "flowAlerts", label: "Workflow alerts", help: "Sent by “Notify team” steps in your workflow." },
  { key: "problems", label: "Problems", help: "CRM delivery failed, 24-hour window closed, automation errors, missing media." },
];

const WEEK: { key: keyof AppSettings["business"]["hours"]; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

/** Timezone (dates, bookings) and opening hours (the "We are open now" condition). */
function BusinessCard({ s, setS }: { s: AppSettings; setS: (next: AppSettings) => void }) {
  const b = s.business;
  const setDay = (key: keyof AppSettings["business"]["hours"], patch: Partial<AppSettings["business"]["hours"]["mon"]>) =>
    setS({ ...s, business: { ...b, hours: { ...b.hours, [key]: { ...b.hours[key], ...patch } } } });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Business hours</CardTitle>
        <CardDescription>Used by the “We are open now” condition, and the timezone for dates and bookings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-1">
          <Label className="text-xs">Timezone</Label>
          <Input value={b.timezone} onChange={(e) => setS({ ...s, business: { ...b, timezone: e.target.value.trim() } })} placeholder="Asia/Kolkata" />
        </div>
        <div className="divide-y rounded-2xl border">
          {WEEK.map(({ key, label }) => {
            const d = b.hours[key];
            return (
              <div key={key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="w-24 text-sm">{label}</span>
                <Switch checked={d.open} onCheckedChange={(v) => setDay(key, { open: v })} aria-label={`${label} open`} />
                {d.open ? (
                  <span className="flex items-center gap-2 text-sm">
                    <Input type="time" value={d.from} onChange={(e) => setDay(key, { from: e.target.value })} className="h-8 w-28" />
                    to
                    <Input type="time" value={d.to} onChange={(e) => setDay(key, { to: e.target.value })} className="h-8 w-28" />
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TelegramCard({ s, setS, tokenSet }: { s: AppSettings; setS: (next: AppSettings) => void; tokenSet: boolean }) {
  const [chats, setChats] = useState(s.telegram.chatIds.join("\n"));
  const [busy, startBusy] = useTransition();
  const tg = s.telegram;
  const setTg = (patch: Partial<AppSettings["telegram"]>) => setS({ ...s, telegram: { ...tg, ...patch } });
  const setChatText = (text: string) => {
    setChats(text);
    setTg({ chatIds: list(text) });
  };

  const findChats = () =>
    startBusy(async () => {
      const r = await findTelegramChatsAction();
      if (!r.ok) return void toast.error(r.error);
      const found = r.data ?? [];
      if (!found.length) return void toast.info("No chats found. Send /start to your bot in Telegram, then try again.");
      const merged = [...new Set([...list(chats), ...found.map((c) => c.id)])];
      setChatText(merged.join("\n"));
      toast.success(`Found ${found.map((c) => `${c.title} (${c.id})`).join(", ")}. Save settings to keep them.`);
    });

  const sendTest = () =>
    startBusy(async () => {
      const r = await sendTelegramTestAction({ chatIds: list(chats) });
      if (r.ok) toast.success("Test alert sent. Check Telegram.");
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Telegram alerts</CardTitle>
        <CardDescription>
          {tokenSet
            ? "Get important events on Telegram. Customer names, numbers and messages are included in the alerts."
            : "Add TELEGRAM_BOT_TOKEN (from @BotFather) to the server environment to turn on Telegram alerts."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Send alerts to Telegram</span>
          <Switch checked={tg.enabled} onCheckedChange={(v) => setTg({ enabled: v })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {TELEGRAM_EVENTS.map((e) => (
            <label key={e.key} className="flex items-start justify-between gap-3 rounded-xl border p-3">
              <span className="space-y-0.5">
                <span className="block text-sm">{e.label}</span>
                <span className="block text-[11px] text-muted-foreground">{e.help}</span>
              </span>
              <Switch checked={tg.events[e.key]} disabled={!tg.enabled} onCheckedChange={(v) => setTg({ events: { ...tg.events, [e.key]: v } })} />
            </label>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Chat IDs (one per line)</Label>
          <Textarea rows={2} value={chats} onChange={(e) => setChatText(e.target.value)} placeholder={"123456789\n-1001234567890"} className="font-mono" />
          <p className="text-[11px] text-muted-foreground">
            Send /start to your bot (or add it to a group and send a message there), then use “Find chat IDs”.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={findChats} disabled={busy || !tokenSet}>
            {busy ? <Loader2 className="animate-spin" /> : <Search />} Find chat IDs
          </Button>
          <Button type="button" variant="outline" onClick={sendTest} disabled={busy || !tokenSet || !list(chats).length}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} Send test alert
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function GeneralSettingsForm({ initial, telegramTokenSet }: { initial: AppSettings; telegramTokenSet: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const [kw, setKw] = useState({ stop: initial.keywords.stop.join(", "), start: initial.keywords.start.join(", "), human: initial.keywords.human.join(", ") });
  const [tests, setTests] = useState(initial.testPhoneNumbers.join("\n"));
  const current = JSON.stringify({ s, kw, tests });
  const [saved, setSaved] = useState(current);
  const dirty = current !== saved;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    start(async () => {
      const testPhoneNumbers = list(tests).map((n) => n.replace(/\D/g, ""));
      const r = await updateSettingsAction({
        keywords: { stop: list(kw.stop), start: list(kw.start), human: list(kw.human) },
        messages: s.messages,
        testPhoneNumbers,
        window: s.window,
        execution: s.execution,
        rateLimits: s.rateLimits,
        retention: s.retention,
        telegram: s.telegram,
        business: s.business,
        coexistence: s.coexistence,
      });
      if (r.ok) {
        setSaved(current);
        toast.success("Settings saved");
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Customer keywords</CardTitle>
          <CardDescription>Exact-word commands customers can send at any time (comma-separated, case-insensitive).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Opt out (STOP)</Label>
            <Input value={kw.stop} onChange={(e) => setKw({ ...kw, stop: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Opt back in (START)</Label>
            <Input value={kw.start} onChange={(e) => setKw({ ...kw, start: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Talk to a human</Label>
            <Input value={kw.human} onChange={(e) => setKw({ ...kw, human: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <Label className="text-xs">Reply after STOP</Label>
            <Textarea rows={2} value={s.messages.stopConfirmation} onChange={(e) => setS({ ...s, messages: { ...s.messages, stopConfirmation: e.target.value } })} />
          </div>
          <div className="space-y-1 sm:col-span-3 lg:col-span-1">
            <Label className="text-xs">Reply after START</Label>
            <Textarea rows={2} value={s.messages.startConfirmation} onChange={(e) => setS({ ...s, messages: { ...s.messages, startConfirmation: e.target.value } })} />
          </div>
          <div className="space-y-1 sm:col-span-3 lg:col-span-2">
            <Label className="text-xs">Reply when handing off to a human</Label>
            <Textarea rows={2} value={s.messages.handoff} onChange={(e) => setS({ ...s, messages: { ...s.messages, handoff: e.target.value } })} />
          </div>
        </CardContent>
      </Card>

      <BusinessCard s={s} setS={setS} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">WhatsApp Business app on the same number</CardTitle>
          <CardDescription>What happens when you reply to a customer from the WhatsApp Business app on your phone.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">When I reply from the phone app</Label>
            <Select value={s.coexistence.onAppReply} onValueChange={(v) => setS({ ...s, coexistence: { ...s.coexistence, onAppReply: v as "pause" | "ignore" } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pause">Pause the bot in that chat until I hand it back</SelectItem>
                <SelectItem value="ignore">Keep the bot running</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Opening or reading a chat does nothing — only sending a message counts.</p>
          </div>
          <Num
            label="Hand back to the bot after (hours without my reply, 0 = never)"
            value={s.coexistence.autoResumeHours}
            onChange={(n) => setS({ ...s, coexistence: { ...s.coexistence, autoResumeHours: Math.max(0, Math.min(336, n)) } })}
          />
        </CardContent>
      </Card>

      <TelegramCard s={s} setS={setS} tokenSet={telegramTokenSet} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Live testing</CardTitle>
          <CardDescription>
            Authorised test numbers (with country code, digits only). Their conversations are marked as tests, excluded from production stats, and
            can run flows published in “Test numbers only” mode. The test customer must still message first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea rows={3} value={tests} onChange={(e) => setTests(e.target.value)} placeholder={"919876543210\n918888888888"} className="font-mono" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Conversation rules</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Num label="Window safety margin (minutes)" value={s.window.safetyMarginMinutes} onChange={(n) => setS({ ...s, window: { ...s.window, safetyMarginMinutes: n } })} help="Treat the 24h window as closed this early." />
          <Num label="Resume unfinished enquiries within (hours)" value={s.execution.resumeWithinHours} onChange={(n) => setS({ ...s, execution: { ...s.execution, resumeWithinHours: n } })} help="Later replies start a fresh enquiry." />
          <Num label="Max automated steps per message" value={s.execution.maxStepsPerRun} onChange={(n) => setS({ ...s, execution: { ...s.execution, maxStepsPerRun: n } })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Rate limits & abuse protection</CardTitle>
          <CardDescription>Applied per customer (WhatsApp ID) after Meta&apos;s signature is verified. Messages are always stored.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Num label="Messages per customer per minute" value={s.rateLimits.inboundPerMinute} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, inboundPerMinute: n } })} />
          <Num label="Violations before cooldown (10 min)" value={s.rateLimits.abuseViolationsBeforeCooldown} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, abuseViolationsBeforeCooldown: n } })} />
          <Num label="Abuse cooldown (minutes)" value={s.rateLimits.abuseCooldownMinutes} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, abuseCooldownMinutes: n } })} />
          <Num label="Login attempts" value={s.rateLimits.loginAttempts} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, loginAttempts: n } })} />
          <Num label="…per (minutes)" value={s.rateLimits.loginWindowMinutes} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, loginWindowMinutes: n } })} />
          <Num label="MFA code attempts" value={s.rateLimits.mfaAttempts} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, mfaAttempts: n } })} />
          <Num label="Flow publishes per hour" value={s.rateLimits.flowPublishesPerHour} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, flowPublishesPerHour: n } })} />
          <Num label="Flow creations per hour" value={s.rateLimits.flowCreatesPerHour} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, flowCreatesPerHour: n } })} />
          <Num label="Max delays per execution" value={s.rateLimits.scheduledJobsPerExecution} onChange={(n) => setS({ ...s, rateLimits: { ...s.rateLimits, scheduledJobsPerExecution: n } })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Privacy & retention</CardTitle>
          <CardDescription>The daily sweep redacts or deletes data older than these limits (0 = keep).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Num label="Redact message text after (days)" value={s.retention.messageBodyDays} onChange={(n) => setS({ ...s, retention: { ...s.retention, messageBodyDays: n } })} />
          <Num label="Delete step logs after (days)" value={s.retention.executionLogDays} onChange={(n) => setS({ ...s, retention: { ...s.retention, executionLogDays: n } })} />
          <Num label="Delete security events after (days)" value={s.retention.securityEventDays} onChange={(n) => setS({ ...s, retention: { ...s.retention, securityEventDays: n } })} />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <div
          className={cn(
            "flex items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 transition-all",
            dirty ? "border bg-background/95 shadow-lg backdrop-blur" : "pl-1.5",
          )}
        >
          {dirty && <span className="text-sm text-muted-foreground">You have unsaved changes</span>}
          <Button onClick={save} disabled={pending || !dirty} className={dirty ? undefined : "shadow-sm"}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} {dirty ? "Save settings" : "Saved"}
          </Button>
        </div>
      </div>
    </div>
  );
}
