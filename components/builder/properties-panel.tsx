"use client";

import { Copy, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import { CONDITION_OPERATORS, LEAD_FIELDS, safeParseNodeConfig, type NodeType } from "@/lib/engine/schema";
import { resolveInteractiveMode, WA_LIMITS } from "@/lib/engine/interactive";
import type { GraphIssue } from "@/lib/engine/validate-graph";
import { Field, MessageField, NumberField, SelectField, SwitchField, TextField } from "./fields";
import { NODE_ICONS } from "./node-icons";
import { useEditorContext } from "./editor-context";
import type { EditorNode } from "./model";

type Config = Record<string, unknown>;

const LEAD_FIELD_LABELS: Record<(typeof LEAD_FIELDS)[number], string> = {
  none: "Don't store on the lead",
  name: "Name",
  business_name: "Business name",
  service: "Service",
  requirements: "Requirements",
  email: "Email",
};

const OPERATOR_LABELS: Record<(typeof CONDITION_OPERATORS)[number], string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains keyword",
  not_contains: "does not contain",
  is_set: "is set",
  is_not_set: "is empty",
  matches_regex: "matches regex",
  customer_is_new: "customer is new",
  customer_is_returning: "customer is returning",
  option_selected: "selected option is",
};

export function PropertiesPanel({
  node,
  issues,
  onChange,
  onLabel,
  onDelete,
  onDuplicate,
}: {
  node: EditorNode | null;
  issues: GraphIssue[];
  onChange: (config: Config) => void;
  onLabel: (label: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  if (!node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a node to edit its properties. Connect nodes by dragging from a bottom handle to the top of another node.
      </div>
    );
  }
  const type = node.data.nodeType;
  const def = NODE_REGISTRY[type];
  const Icon = NODE_ICONS[type];
  const c = node.data.config;
  const set = (patch: Config) => onChange({ ...c, ...patch });
  const parsed = safeParseNodeConfig(type, c);
  const fieldErrors = new Map<string, string>();
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors.set(String(i.path[0] ?? ""), i.message);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-md" style={{ background: `${def.color}1a`, color: def.color }}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{def.label}</div>
          <p className="text-[11px] text-muted-foreground">{def.description}</p>
        </div>
      </div>
      <Field label="Node name">
        <TextField value={node.data.label} onChange={onLabel} maxLength={80} />
      </Field>
      <Separator />
      <NodeForm type={type} c={c} set={set} errors={fieldErrors} />
      {issues.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2.5">
          {issues.map((i, idx) => (
            <p key={idx} className={i.level === "error" ? "text-xs text-red-700" : "text-xs text-amber-800"}>
              {i.level === "error" ? "Error: " : "Warning: "}
              {i.message}
            </p>
          ))}
        </div>
      )}
      <Separator />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onDuplicate} disabled={def.singleton}>
          <Copy /> Duplicate
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 /> Delete
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Node ID: {node.id}</p>
    </div>
  );
}

function NodeForm({ type, c, set, errors }: { type: NodeType; c: Config; set: (p: Config) => void; errors: Map<string, string> }) {
  const { media, crm } = useEditorContext();
  const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  const num = (k: string) => (typeof c[k] === "number" ? (c[k] as number) : null);
  const bool = (k: string) => Boolean(c[k]);

  switch (type) {
    case "trigger": {
      const keywords = (c.keywords as string[]) ?? [];
      return (
        <div className="space-y-3">
          <div className="rounded-md bg-emerald-50 p-2.5 text-[11px] text-emerald-800">
            Flows only start when a customer messages your number. The bot never sends the first message.
          </div>
          <Field label="Start when the message is">
            <SelectField
              value={str("match") as "any" | "keywords"}
              onChange={(v) => set({ match: v })}
              options={[
                { value: "any", label: "Any customer message" },
                { value: "keywords", label: "Matching keywords" },
              ]}
            />
          </Field>
          {c.match === "keywords" && (
            <>
              <Field label="Keywords" help="Comma-separated, e.g. price, quote, offer" error={errors.get("keywords")}>
                <TextField
                  value={keywords.join(", ")}
                  onChange={(v) => set({ keywords: v.split(",").map((k) => k.trim()).filter(Boolean) })}
                />
              </Field>
              <Field label="Match mode">
                <SelectField
                  value={str("matchMode") as "contains"}
                  onChange={(v) => set({ matchMode: v })}
                  options={[
                    { value: "contains", label: "Message contains keyword" },
                    { value: "exact", label: "Message is exactly the keyword" },
                    { value: "starts_with", label: "Message starts with keyword" },
                  ]}
                />
              </Field>
            </>
          )}
          <Field label="Customer type">
            <SelectField
              value={str("customerType") as "any"}
              onChange={(v) => set({ customerType: v })}
              options={[
                { value: "any", label: "New and returning customers" },
                { value: "new", label: "New customers only" },
                { value: "returning", label: "Returning customers only" },
              ]}
            />
          </Field>
        </div>
      );
    }

    case "send_message":
      return (
        <Field label="Message" error={errors.get("text")}>
          <MessageField value={str("text")} onChange={(v) => set({ text: v })} rows={6} />
        </Field>
      );

    case "send_media": {
      const kind = str("mediaType") as "document" | "image" | "video";
      const options = media.filter((m) => m.kind === kind);
      return (
        <div className="space-y-3">
          <Field label="Media type">
            <SelectField
              value={kind}
              onChange={(v) => set({ mediaType: v, assetId: null })}
              options={[
                { value: "document", label: "PDF / document" },
                { value: "image", label: "Image" },
                { value: "video", label: "Video" },
              ]}
            />
          </Field>
          <Field
            label="File"
            help={
              <>
                Choose from the{" "}
                <a href="/media" target="_blank" className="underline">
                  Media Library
                </a>{" "}
                (upload new files there).
              </>
            }
          >
            <SelectField
              value={str("assetId")}
              onChange={(v) => set({ assetId: v })}
              placeholder={options.length ? "Select a file…" : "No files of this type yet"}
              options={options.map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field label="Caption (optional)">
            <MessageField value={str("caption")} onChange={(v) => set({ caption: v })} rows={2} maxLength={1024} />
          </Field>
          {kind === "document" && (
            <Field label="File name shown to the customer">
              <TextField value={str("filename")} onChange={(v) => set({ filename: v })} placeholder="Brochure.pdf" />
            </Field>
          )}
          <Field label="Resend cooldown (hours)" help="Don't send the same file to the same customer again within this time. 0 = always send.">
            <NumberField value={num("cooldownHours")} onChange={(v) => set({ cooldownHours: v ?? 0 })} min={0} max={720} />
          </Field>
        </div>
      );
    }

    case "wait":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Delay" error={errors.get("amount")}>
              <NumberField value={num("amount")} onChange={(v) => set({ amount: v ?? 1 })} min={1} />
            </Field>
            <Field label="Unit">
              <SelectField
                value={str("unit") as "seconds"}
                onChange={(v) => set({ unit: v })}
                options={[
                  { value: "seconds", label: "Seconds" },
                  { value: "minutes", label: "Minutes" },
                  { value: "hours", label: "Hours" },
                ]}
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Each Wait schedules exactly one QStash delivery. Delays longer than the 24-hour service window will not be able
            to send a reply.
          </p>
          <SwitchField
            label="Essential delay"
            help="When the hard usage cap is reached, non-essential delays are skipped (the flow continues immediately)."
            checked={bool("essential")}
            onChange={(v) => set({ essential: v })}
          />
        </div>
      );

    case "ask_question":
      return (
        <div className="space-y-3">
          <Field label="Question" error={errors.get("question")}>
            <MessageField value={str("question")} onChange={(v) => set({ question: v })} rows={3} />
          </Field>
          <Field label="Store answer in variable" help={`Use as {{vars.${str("variable") || "name"}}}`} error={errors.get("variable")}>
            <TextField value={str("variable")} onChange={(v) => set({ variable: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
          </Field>
          <Field label="Map to lead field">
            <SelectField
              value={str("leadField") as "none"}
              onChange={(v) => set({ leadField: v })}
              options={LEAD_FIELDS.map((f) => ({ value: f, label: LEAD_FIELD_LABELS[f] }))}
            />
          </Field>
        </div>
      );

    case "interactive": {
      const options = (c.options as { id: string; title: string; description: string }[]) ?? [];
      const setOptions = (next: typeof options) => set({ options: next });
      let mode = "list";
      try {
        mode = resolveInteractiveMode(c as never);
      } catch {}
      return (
        <div className="space-y-3">
          <Field label="Question text" error={errors.get("body")}>
            <MessageField value={str("body")} onChange={(v) => set({ body: v })} rows={3} maxLength={1024} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Header (optional)">
              <TextField value={str("header")} onChange={(v) => set({ header: v })} maxLength={60} />
            </Field>
            <Field label="List button text">
              <TextField value={str("buttonText")} onChange={(v) => set({ buttonText: v })} maxLength={20} />
            </Field>
          </div>
          <Field label="Footer (optional)" help="Tip: mention the number fallback, e.g. “Or reply with 1–6”.">
            <TextField value={str("footer")} onChange={(v) => set({ footer: v })} maxLength={60} />
          </Field>
          <Field label="Display as">
            <SelectField
              value={str("mode") as "auto"}
              onChange={(v) => set({ mode: v })}
              options={[
                { value: "auto", label: "Automatic (buttons ≤ 3, list ≤ 10)" },
                { value: "buttons", label: "Reply buttons (max 3)" },
                { value: "list", label: "List message (max 10)" },
                { value: "text", label: "Numbered text only" },
              ]}
            />
          </Field>
          <div className="text-[11px] text-muted-foreground">
            Will be sent as: <Badge variant="secondary">{mode}</Badge> · customers can always reply with the option number.
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Options</span>
              <Button
                variant="outline"
                size="xs"
                disabled={options.length >= WA_LIMITS.maxListRows}
                onClick={() => setOptions([...options, { id: `opt_${options.length + 1}`, title: `Option ${options.length + 1}`, description: "" }])}
              >
                <Plus /> Add
              </Button>
            </div>
            {options.map((o, i) => (
              <div key={i} className="rounded-md border p-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-4 text-xs text-muted-foreground">{i + 1}.</span>
                  <Input
                    value={o.title}
                    maxLength={24}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    className="h-7 text-sm"
                    placeholder="Title (max 24)"
                  />
                  <Button variant="ghost" size="icon-xs" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Remove option">
                    <X />
                  </Button>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 pl-5">
                  <Input
                    value={o.id}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, id: e.target.value.replace(/[^A-Za-z0-9_\-.:]/g, "_") } : x)))}
                    className="h-7 font-mono text-[11px]"
                    placeholder="option_id"
                  />
                  <Input
                    value={o.description}
                    maxLength={72}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                    className="h-7 text-[11px]"
                    placeholder="Description (list only)"
                  />
                </div>
              </div>
            ))}
            {errors.get("options") && <p className="text-[11px] text-destructive">{errors.get("options")}</p>}
          </div>
          <Field label="Store selection in variable" help={`{{vars.${str("variable")}}} is the title, {{vars.${str("variable")}.id}} the option ID`}>
            <TextField value={str("variable")} onChange={(v) => set({ variable: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
          </Field>
          <Field label="Map to lead field">
            <SelectField
              value={str("leadField") as "none"}
              onChange={(v) => set({ leadField: v })}
              options={LEAD_FIELDS.map((f) => ({ value: f, label: LEAD_FIELD_LABELS[f] }))}
            />
          </Field>
        </div>
      );
    }

    case "validation": {
      const allowed = (c.allowedOptionIds as string[]) ?? [];
      return (
        <div className="space-y-3">
          <Field label="Variable to check" error={errors.get("variable")}>
            <TextField value={str("variable")} onChange={(v) => set({ variable: v })} />
          </Field>
          <SwitchField label="Required" checked={bool("required")} onChange={(v) => set({ required: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min length">
              <NumberField value={num("minLength")} onChange={(v) => set({ minLength: v })} min={0} allowNull />
            </Field>
            <Field label="Max length">
              <NumberField value={num("maxLength")} onChange={(v) => set({ maxLength: v })} min={1} allowNull />
            </Field>
          </div>
          <Field label="Format">
            <SelectField
              value={str("preset") as "none"}
              onChange={(v) => set({ preset: v })}
              options={[
                { value: "none", label: "Any text" },
                { value: "name", label: "Person name" },
                { value: "business_name", label: "Business name" },
                { value: "email", label: "Email address" },
                { value: "phone", label: "Phone number" },
              ]}
            />
          </Field>
          <Field label="Custom regex (optional)" error={errors.get("pattern")}>
            <TextField value={str("pattern")} onChange={(v) => set({ pattern: v })} className="h-8 font-mono text-xs" placeholder="^[A-Za-z ]+$" />
          </Field>
          <Field label="Allowed option IDs (interactive answers)" help="Comma-separated. Empty = any matched option.">
            <TextField
              value={allowed.join(", ")}
              onChange={(v) => set({ allowedOptionIds: v.split(",").map((x) => x.trim()).filter(Boolean) })}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Message when the answer is invalid" error={errors.get("errorMessage")}>
            <MessageField value={str("errorMessage")} onChange={(v) => set({ errorMessage: v })} rows={3} />
          </Field>
          <Field label="Maximum attempts" help="After this many invalid answers the “Retries exhausted” branch runs (e.g. human handoff).">
            <NumberField value={num("maxAttempts")} onChange={(v) => set({ maxAttempts: v ?? 3 })} min={1} max={10} />
          </Field>
        </div>
      );
    }

    case "condition": {
      const op = str("operator") as (typeof CONDITION_OPERATORS)[number];
      const needsValue = !["is_set", "is_not_set", "customer_is_new", "customer_is_returning"].includes(op);
      const needsLeft = !["customer_is_new", "customer_is_returning"].includes(op);
      return (
        <div className="space-y-3">
          {needsLeft && (
            <Field label="Value to test" help="A variable, e.g. {{vars.service.id}}, {{contact.name}}, {{vars.last_message}}">
              <TextField value={str("left")} onChange={(v) => set({ left: v })} className="h-8 font-mono text-xs" />
            </Field>
          )}
          <Field label="Operator">
            <SelectField
              value={op}
              onChange={(v) => set({ operator: v })}
              options={CONDITION_OPERATORS.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))}
            />
          </Field>
          {needsValue && (
            <Field label="Compare with">
              <TextField value={str("right")} onChange={(v) => set({ right: v })} />
            </Field>
          )}
          {needsValue && <SwitchField label="Case sensitive" checked={bool("caseSensitive")} onChange={(v) => set({ caseSensitive: v })} />}
        </div>
      );
    }

    case "save_lead": {
      const mapping = (c.mapping as Record<string, string>) ?? {};
      const qualify = (c.qualifyWhen as string[]) ?? [];
      const fields = ["name", "business_name", "service", "requirements", "email"] as const;
      return (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">Map collected answers to lead fields. Leave empty to skip a field.</p>
          {fields.map((f) => (
            <Field key={f} label={LEAD_FIELD_LABELS[f]}>
              <TextField
                value={mapping[f] ?? ""}
                onChange={(v) => set({ mapping: { ...mapping, [f]: v } })}
                className="h-8 font-mono text-xs"
                placeholder={`{{vars.${f}}}`}
              />
            </Field>
          ))}
          <Field label="Mark as qualified when these are present">
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f) => {
                const on = qualify.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => set({ qualifyWhen: on ? qualify.filter((x) => x !== f) : [...qualify, f] })}
                    className={`rounded-md border px-2 py-0.5 text-[11px] ${on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}
                  >
                    {LEAD_FIELD_LABELS[f]}
                  </button>
                );
              })}
            </div>
          </Field>
          <SwitchField
            label="Update the contact profile"
            help="Remember name and business for returning customers."
            checked={bool("updateContact")}
            onChange={(v) => set({ updateContact: v })}
          />
        </div>
      );
    }

    case "crm_webhook":
      return (
        <div className="space-y-3">
          <Field label="Destination">
            <SelectField
              value={str("integrationId") || "__all"}
              onChange={(v) => set({ integrationId: v === "__all" ? null : v })}
              options={[
                { value: "__all", label: "All enabled CRM integrations" },
                ...crm.map((i) => ({ value: i.id, label: `${i.name}${i.enabled ? "" : " (disabled)"}` })),
              ]}
            />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            The lead is saved locally first. Failed deliveries are retried automatically and never lose the lead. Configure
            endpoints under{" "}
            <a href="/crm" target="_blank" className="underline">
              CRM Integrations
            </a>
            .
          </p>
        </div>
      );

    case "handoff":
      return (
        <div className="space-y-3">
          <Field label="Message to the customer (optional)">
            <MessageField value={str("message")} onChange={(v) => set({ message: v })} rows={3} />
          </Field>
          <Field label="Reason shown to your team">
            <TextField value={str("reason")} onChange={(v) => set({ reason: v })} maxLength={200} />
          </Field>
          <p className="text-[11px] text-muted-foreground">Automation stops and the conversation appears in Conversations → Needs reply.</p>
        </div>
      );

    case "end":
      return <p className="text-sm text-muted-foreground">Marks the execution as completed.</p>;
  }
}
