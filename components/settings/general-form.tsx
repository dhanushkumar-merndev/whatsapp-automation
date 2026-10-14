"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateSettingsAction } from "@/app/(dashboard)/settings/actions";
import type { AppSettings } from "@/lib/settings/schema";

const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function Num({ label, value, onChange, help }: { label: string; value: number; onChange: (n: number) => void; help?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
    </div>
  );
}

export function GeneralSettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const [kw, setKw] = useState({ stop: initial.keywords.stop.join(", "), start: initial.keywords.start.join(", "), human: initial.keywords.human.join(", ") });
  const [tests, setTests] = useState(initial.testPhoneNumbers.join("\n"));

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
        hosting: s.hosting,
        estimator: s.estimator,
      });
      if (r.ok) {
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Hosting & estimator defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Vercel plan</Label>
            <Select value={s.hosting.plan} onValueChange={(v) => setS({ ...s, hosting: { ...s.hosting, plan: v as AppSettings["hosting"]["plan"] } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hobby">Hobby (non-commercial)</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Environment</Label>
            <Select value={s.hosting.environment} onValueChange={(v) => setS({ ...s, hosting: { ...s.hosting, environment: v as AppSettings["hosting"]["environment"] } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="development">Development / testing</SelectItem>
                <SelectItem value="production">Commercial production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Meta pricing country</Label>
            <Input value={s.estimator.metaCountryCode} maxLength={4} onChange={(e) => setS({ ...s, estimator: { ...s.estimator, metaCountryCode: e.target.value.toUpperCase() } })} />
          </div>
          <Num label="Default customers / day" value={s.estimator.customersPerDay} onChange={(n) => setS({ ...s, estimator: { ...s.estimator, customersPerDay: n } })} />
          <Num label="Default completion rate (%)" value={Math.round(s.estimator.completionRate * 100)} onChange={(n) => setS({ ...s, estimator: { ...s.estimator, completionRate: Math.min(1, Math.max(0, n / 100)) } })} />
          <Num label="DB size per conversation (KB)" value={s.estimator.dbKbPerConversation} onChange={(n) => setS({ ...s, estimator: { ...s.estimator, dbKbPerConversation: n } })} />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button size="lg" onClick={save} disabled={pending} className="shadow-lg">
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save settings
        </Button>
      </div>
    </div>
  );
}
