"use client";

import { useMemo } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CircleX, Copy, ExternalLink, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/common/copy-button";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import { LEAD_FIELDS, safeParseNodeConfig, type FlowDefinition, type InteractiveOption, type NodeType } from "@/lib/engine/schema";
import { WA_LIMITS } from "@/lib/engine/interactive";
import type { GraphIssue } from "@/lib/engine/validate-graph";
import { listFlowVariables, type FlowVariable } from "@/lib/engine/variables";
import { cn } from "@/lib/utils";
import {
  Advanced,
  Chips,
  Field,
  MessageField,
  Note,
  NumberField,
  PickOrCustom,
  Section,
  SelectField,
  SwitchField,
  TagInput,
  TextField,
  VariablesContext,
  type SelectOption,
} from "./fields";
import { CUSTOMER_OPERATORS, LEAD_FIELD_LABELS, OPERATOR_LABELS, type ConditionOperator } from "./labels";
import { NODE_ICONS } from "./node-icons";
import { useEditorContext } from "./editor-context";
import { handleColor, type EditorNode } from "./model";
import { InteractivePreview, TextPreview } from "./wa-preview";

type Config = Record<string, unknown>;

export function PropertiesPanel({
  node,
  definition,
  issues,
  onChange,
  onLabel,
  onDelete,
  onDuplicate,
}: {
  node: EditorNode;
  /** The current flow, for variables and branch targets. */
  definition: FlowDefinition;
  issues: GraphIssue[];
  onChange: (config: Config) => void;
  onLabel: (label: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const variables = useMemo(() => listFlowVariables(definition), [definition]);
  const type = node.data.nodeType;
  const def = NODE_REGISTRY[type];
  const Icon = NODE_ICONS[type];
  const c = node.data.config;
  const set = (patch: Config) => onChange({ ...c, ...patch });
  const parsed = safeParseNodeConfig(type, c);
  const fieldErrors = new Map<string, string>();
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors.set(String(i.path[0] ?? ""), i.message);

  return (
    <VariablesContext.Provider value={variables}>
      <div className="space-y-5 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <input
              value={node.data.label}
              onChange={(e) => onLabel(e.target.value)}
              maxLength={80}
              placeholder={def.label}
              aria-label="Step name"
              className="-mx-1.5 w-[calc(100%+0.75rem)] rounded-lg bg-transparent px-1.5 py-0.5 text-[15px] font-semibold outline-none hover:bg-muted focus:bg-muted"
            />
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{def.description}</p>
          </div>
          <div className="flex shrink-0 gap-0.5">
            {!def.singleton && (
              <Button variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label="Duplicate step" title="Duplicate">
                <Copy />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete step" title="Delete" className="text-destructive hover:text-destructive">
              <Trash2 />
            </Button>
          </div>
        </div>

        {issues.length > 0 && (
          <ul className="space-y-1.5 rounded-2xl border border-warning/30 bg-warning/5 p-3">
            {issues.map((i, idx) => (
              <li key={idx} className={cn("flex items-start gap-2 text-xs leading-relaxed", i.level === "error" ? "text-destructive" : "text-warning")}>
                {i.level === "error" ? <CircleX className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                <span>{i.message.replace(/^“[^”]*”:?\s*/, "")}</span>
              </li>
            ))}
          </ul>
        )}

        <NodeForm key={node.id} nodeId={node.id} type={type} c={c} set={set} errors={fieldErrors} variables={variables} definition={definition} />

        <div className="flex items-center gap-1 border-t pt-3 text-[11px] text-muted-foreground">
          Step ID <code className="font-mono">{node.id}</code>
          <CopyButton value={node.id} label="" className="size-6" />
        </div>
      </div>
    </VariablesContext.Provider>
  );
}

/** Variables as template options, e.g. value "{{vars.name}}". */
function templateOptions(variables: FlowVariable[]): SelectOption[] {
  return variables.map((v) => ({ value: `{{${v.path}}}`, label: v.label, group: v.group === "Answers" ? "Answers from this flow" : v.group }));
}

/** "{{vars.service.id}}" or "{{vars.service}}" → "service". */
function answerName(template: string): string | null {
  const m = /^\{\{\s*vars\.([a-z0-9_]+)(?:\.id)?\s*\}\}$/.exec(template.trim());
  return m ? m[1] : null;
}

/** Where each branch of a step goes, e.g. "Yes → Send brochure". */
function Branches({ nodeId, type, definition }: { nodeId: string; type: NodeType; definition: FlowDefinition }) {
  const outputs = NODE_REGISTRY[type].outputs;
  return (
    <Section title="Then">
      <div className="divide-y rounded-2xl border">
        {outputs.map((o) => {
          const edge = definition.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? "out") === o.id);
          const target = edge && definition.nodes.find((n) => n.id === edge.target);
          return (
            <div key={o.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
              <span className="w-14 shrink-0 font-medium" style={{ color: handleColor(o.id) }}>
                {o.label}
              </span>
              <span className="text-muted-foreground">→</span>
              {target ? (
                <span className="truncate">{target.data.label || NODE_REGISTRY[target.type].label}</span>
              ) : (
                <span className="text-muted-foreground">Not connected yet — use the + under this branch</span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SaveAnswerFields({ c, set, errors }: { c: Config; set: (p: Config) => void; errors: Map<string, string> }) {
  const variable = typeof c.variable === "string" ? c.variable : "";
  const leadField = typeof c.leadField === "string" ? c.leadField : "none";
  return (
    <Section title="Save the answer">
      <Field label="Save to the lead as">
        <SelectField
          value={leadField as (typeof LEAD_FIELDS)[number]}
          onChange={(lf) => {
            // Keep the variable name in step with the lead field until it has been renamed by hand.
            const auto = !variable || variable === leadField || variable === "answer" || variable === "choice";
            set({ leadField: lf, ...(auto && lf !== "none" ? { variable: lf } : {}) });
          }}
          options={LEAD_FIELDS.map((f) => ({ value: f, label: LEAD_FIELD_LABELS[f] }))}
        />
      </Field>
      <Field
        label="Variable name"
        help={
          <>
            Use it in later messages as <code className="rounded bg-muted px-1 font-mono">{`{{vars.${variable || "name"}}}`}</code>
          </>
        }
        error={errors.get("variable")}
      >
        <TextField value={variable} onChange={(v) => set({ variable: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} className="font-mono text-xs" />
      </Field>
    </Section>
  );
}

function NodeForm({
  nodeId,
  type,
  c,
  set,
  errors,
  variables,
  definition,
}: {
  nodeId: string;
  type: NodeType;
  c: Config;
  set: (p: Config) => void;
  errors: Map<string, string>;
  variables: FlowVariable[];
  definition: FlowDefinition;
}) {
  const { media, crm } = useEditorContext();
  const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  const num = (k: string) => (typeof c[k] === "number" ? (c[k] as number) : null);
  const bool = (k: string) => Boolean(c[k]);

  switch (type) {
    case "trigger": {
      const keywords = (c.keywords as string[]) ?? [];
      return (
        <div className="space-y-4">
          <Field label="Start when a customer sends">
            <Chips
              value={c.match === "keywords" ? "keywords" : "any"}
              onChange={(v) => set({ match: v })}
              options={[
                { value: "any", label: "Any message" },
                { value: "keywords", label: "Certain keywords" },
              ]}
            />
          </Field>
          {c.match === "keywords" && (
            <>
              <Field label="Keywords" help="Press Enter after each keyword." error={errors.get("keywords")}>
                <TagInput value={keywords} onChange={(v) => set({ keywords: v })} placeholder="price, quote, offer" />
              </Field>
              <Field label="How to match">
                <SelectField
                  value={str("matchMode") as "contains"}
                  onChange={(v) => set({ matchMode: v })}
                  options={[
                    { value: "contains", label: "Message contains the keyword" },
                    { value: "exact", label: "Message is exactly the keyword" },
                    { value: "starts_with", label: "Message starts with the keyword" },
                  ]}
                />
              </Field>
            </>
          )}
          <Field label="Which customers">
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
          <Note>Flows only start when a customer messages your number. The bot never sends the first message.</Note>
        </div>
      );
    }

    case "send_message":
      return (
        <div className="space-y-4">
          <Field label="Message" error={errors.get("text")}>
            <MessageField value={str("text")} onChange={(v) => set({ text: v })} rows={5} placeholder="Type the reply…" />
          </Field>
          <TextPreview text={str("text")} />
          <Advanced>
            <Field label="Don't repeat within" help="Skip this message if the same customer already got it recently. 0 = send every time.">
              <NumberField value={num("cooldownHours") ?? 0} onChange={(v) => set({ cooldownHours: v ?? 0 })} min={0} max={720} suffix="hours" />
            </Field>
          </Advanced>
        </div>
      );

    case "send_media": {
      const kind = (str("mediaType") || "document") as "document" | "image" | "video";
      const files = media.filter((m) => m.kind === kind);
      return (
        <div className="space-y-4">
          <Field label="Type">
            <Chips
              value={kind}
              onChange={(v) => set({ mediaType: v, assetId: null })}
              options={[
                { value: "document", label: "PDF / document" },
                { value: "image", label: "Image" },
                { value: "video", label: "Video" },
              ]}
            />
          </Field>
          <Field label="File">
            {files.length ? (
              <SelectField
                value={str("assetId")}
                onChange={(v) => set({ assetId: v })}
                placeholder="Choose a file…"
                options={files.map((m) => ({ value: m.id, label: m.name }))}
              />
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                No {kind === "document" ? "documents" : `${kind}s`} uploaded yet.
                <Button variant="outline" size="xs" asChild>
                  <a href="/media" target="_blank" rel="noreferrer">
                    Media Library <ExternalLink />
                  </a>
                </Button>
              </div>
            )}
          </Field>
          <Field label="Caption (optional)">
            <MessageField value={str("caption")} onChange={(v) => set({ caption: v })} rows={2} maxLength={1024} />
          </Field>
          {kind === "document" && (
            <Field label="File name the customer sees">
              <TextField value={str("filename")} onChange={(v) => set({ filename: v })} placeholder="Brochure.pdf" />
            </Field>
          )}
          <Advanced>
            <Field label="Don't resend within" help="Skip the file if this customer already received it recently. 0 = send every time.">
              <NumberField value={num("cooldownHours")} onChange={(v) => set({ cooldownHours: v ?? 0 })} min={0} max={720} suffix="hours" />
            </Field>
          </Advanced>
        </div>
      );
    }

    case "wait": {
      const amount = num("amount") ?? 1;
      const unit = (str("unit") || "seconds") as "seconds" | "minutes" | "hours";
      const seconds = amount * (unit === "hours" ? 3600 : unit === "minutes" ? 60 : 1);
      const presets = [
        { key: "10s", amount: 10, unit: "seconds", label: "10 sec" },
        { key: "1m", amount: 1, unit: "minutes", label: "1 min" },
        { key: "5m", amount: 5, unit: "minutes", label: "5 min" },
        { key: "1h", amount: 1, unit: "hours", label: "1 hour" },
      ] as const;
      return (
        <div className="space-y-4">
          <Field label="Wait for" error={errors.get("amount")}>
            <div className="grid grid-cols-[1fr_8.5rem] gap-2">
              <NumberField value={amount} onChange={(v) => set({ amount: v ?? 1 })} min={1} />
              <SelectField
                value={unit}
                onChange={(v) => set({ unit: v })}
                options={[
                  { value: "seconds", label: "Seconds" },
                  { value: "minutes", label: "Minutes" },
                  { value: "hours", label: "Hours" },
                ]}
              />
            </div>
          </Field>
          <Chips
            value={presets.find((p) => p.amount === amount && p.unit === unit)?.key ?? null}
            onChange={(k) => {
              const p = presets.find((x) => x.key === k)!;
              set({ amount: p.amount, unit: p.unit });
            }}
            options={presets.map((p) => ({ value: p.key, label: p.label }))}
          />
          {seconds > 24 * 3600 ? (
            <Note tone="warning">Longer than 24 hours: WhatsApp’s reply window will have closed, so the next message can’t be sent.</Note>
          ) : seconds <= 20 ? (
            <Note>Short waits happen instantly inside the reply, and the customer sees “typing…” meanwhile.</Note>
          ) : (
            <Note>The next step runs after this delay (scheduled with QStash).</Note>
          )}
        </div>
      );
    }

    case "ask_question":
      return (
        <div className="space-y-5">
          <Field label="Question" error={errors.get("question")}>
            <MessageField value={str("question")} onChange={(v) => set({ question: v })} rows={3} placeholder="What would you like to ask?" />
          </Field>
          <SaveAnswerFields c={c} set={set} errors={errors} />
        </div>
      );

    case "interactive": {
      const options = (c.options as InteractiveOption[]) ?? [];
      const setOptions = (next: InteractiveOption[]) => set({ options: next });
      const update = (i: number, patch: Partial<InteractiveOption>) => setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
      const move = (i: number, d: -1 | 1) => {
        const next = [...options];
        const [x] = next.splice(i, 1);
        next.splice(i + d, 0, x);
        setOptions(next);
      };
      const newId = () => {
        let n = options.length + 1;
        while (options.some((o) => o.id === `opt_${n}`)) n++;
        return `opt_${n}`;
      };
      return (
        <div className="space-y-5">
          <Field label="Message" error={errors.get("body")}>
            <MessageField value={str("body")} onChange={(v) => set({ body: v })} rows={3} maxLength={1024} placeholder="Please choose an option:" />
          </Field>
          <Section
            title={`Options · ${options.length}/${WA_LIMITS.maxListRows}`}
            aside={
              <Button
                variant="outline"
                size="xs"
                disabled={options.length >= WA_LIMITS.maxListRows}
                onClick={() => setOptions([...options, { id: newId(), title: `Option ${options.length + 1}`, description: "" }])}
              >
                <Plus /> Add option
              </Button>
            }
          >
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="rounded-2xl border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums">{i + 1}</span>
                    <Input
                      value={o.title}
                      maxLength={24}
                      onChange={(e) => update(i, { title: e.target.value })}
                      className="h-8 rounded-lg text-sm"
                      placeholder="Option title"
                      aria-label={`Option ${i + 1} title`}
                    />
                    <span className="w-9 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">{o.title.length}/24</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 pl-8">
                    <Input
                      value={o.description}
                      maxLength={72}
                      onChange={(e) => update(i, { description: e.target.value })}
                      className="h-7 rounded-lg text-xs"
                      placeholder="Description (optional, list only)"
                      aria-label={`Option ${i + 1} description`}
                    />
                    <Button variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" disabled={i === options.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-xs" disabled={options.length <= 1} onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Remove option">
                      <X />
                    </Button>
                  </div>
                </div>
              ))}
              {errors.get("options") && <p className="text-xs text-destructive">{errors.get("options")}</p>}
            </div>
          </Section>
          <InteractivePreview config={c} />
          <SaveAnswerFields c={c} set={set} errors={errors} />
          <Advanced>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Header">
                <TextField value={str("header")} onChange={(v) => set({ header: v })} maxLength={60} placeholder="Optional" />
              </Field>
              <Field label="List button text">
                <TextField value={str("buttonText")} onChange={(v) => set({ buttonText: v })} maxLength={20} />
              </Field>
            </div>
            <Field label="Footer" help="Tip: mention the number fallback, e.g. “Or reply with 1–6”.">
              <TextField value={str("footer")} onChange={(v) => set({ footer: v })} maxLength={60} placeholder="Optional" />
            </Field>
            <Field label="Show options as">
              <SelectField
                value={str("mode") as "auto"}
                onChange={(v) => set({ mode: v })}
                options={[
                  { value: "auto", label: "Automatic (buttons for up to 3, else a list)" },
                  { value: "buttons", label: "Reply buttons (max 3)" },
                  { value: "list", label: "List (max 10)" },
                  { value: "text", label: "Numbered text only" },
                ]}
              />
            </Field>
            <Field label="Option IDs" help="Used by Conditions and sent to your CRM. Only change them if something depends on a specific ID.">
              <div className="space-y-1.5">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{o.title || `Option ${i + 1}`}</span>
                    <Input
                      value={o.id}
                      onChange={(e) => update(i, { id: e.target.value.replace(/[^A-Za-z0-9_\-.:]/g, "_") })}
                      className="h-7 rounded-lg font-mono text-[11px]"
                      aria-label={`Option ${i + 1} ID`}
                    />
                  </div>
                ))}
              </div>
            </Field>
          </Advanced>
        </div>
      );
    }

    case "validation": {
      const allowed = (c.allowedOptionIds as string[]) ?? [];
      const answers = variables.filter((v) => v.group === "Answers");
      const target = answers.find((v) => v.name === str("variable"));
      return (
        <div className="space-y-5">
          <Field label="Answer to check" error={errors.get("variable")}>
            <PickOrCustom
              value={str("variable")}
              onChange={(v) => set({ variable: v, allowedOptionIds: [] })}
              options={answers.map((v) => ({ value: v.name!, label: v.label }))}
              placeholder="Choose a question…"
              customPlaceholder="variable_name"
            />
          </Field>
          <Field label="Must be">
            <SelectField
              value={str("preset") as "none"}
              onChange={(v) => set({ preset: v })}
              options={[
                { value: "none", label: "Any text" },
                { value: "name", label: "A person's name" },
                { value: "business_name", label: "A business name" },
                { value: "email", label: "An email address" },
                { value: "phone", label: "A phone number" },
              ]}
            />
          </Field>
          {target?.options && target.options.length > 0 && (
            <Field label="Only accept these options" help="Leave all off to accept any option.">
              <div className="flex flex-wrap gap-1.5">
                {target.options.map((o) => {
                  const on = allowed.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => set({ allowedOptionIds: on ? allowed.filter((x) => x !== o.id) : [...allowed, o.id] })}
                      className={cn("rounded-full border px-3 py-1 text-xs transition-colors", on ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
                    >
                      {o.title || o.id}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min length">
              <NumberField value={num("minLength")} onChange={(v) => set({ minLength: v })} min={0} max={4096} allowNull placeholder="Any" />
            </Field>
            <Field label="Max length">
              <NumberField value={num("maxLength")} onChange={(v) => set({ maxLength: v })} min={1} max={4096} allowNull placeholder="Any" />
            </Field>
          </div>
          <SwitchField label="Answer is required" checked={bool("required")} onChange={(v) => set({ required: v })} />
          <Field label="Reply when the answer isn't valid" error={errors.get("errorMessage")}>
            <MessageField value={str("errorMessage")} onChange={(v) => set({ errorMessage: v })} rows={2} />
          </Field>
          <Field label="Tries before giving up" help="After this many invalid answers the Failed branch runs. Connect it to a Human handoff.">
            <NumberField value={num("maxAttempts")} onChange={(v) => set({ maxAttempts: v ?? 3 })} min={1} max={10} />
          </Field>
          <Branches nodeId={nodeId} type={type} definition={definition} />
          <Advanced>
            <Field label="Custom pattern (regex)" help="Optional. The answer must match this regular expression." error={errors.get("pattern")}>
              <TextField value={str("pattern")} onChange={(v) => set({ pattern: v })} className="font-mono text-xs" placeholder="^[A-Za-z ]+$" />
            </Field>
          </Advanced>
        </div>
      );
    }

    case "condition": {
      const op = (str("operator") || "equals") as ConditionOperator;
      const aboutCustomer = CUSTOMER_OPERATORS.includes(op);
      const leftName = answerName(str("left"));
      const leftVar = variables.find((v) => v.name && v.name === leftName);
      const choices = leftVar?.options;
      const leftValue = leftVar ? `{{vars.${leftName}}}` : str("left");
      const needsValue = !["is_set", "is_not_set"].includes(op);
      const firstAnswer = variables.find((v) => v.group === "Answers");

      const setLeft = (tpl: string) => {
        const name = answerName(tpl);
        const v = variables.find((x) => x.name && x.name === name);
        if (v?.options?.length) set({ left: `{{vars.${name}.id}}`, operator: "option_selected", right: v.options[0].id });
        else set({ left: tpl, operator: op === "option_selected" ? "equals" : op, ...(op === "option_selected" ? { right: "" } : {}) });
      };
      const setOperator = (next: ConditionOperator) => {
        if (next === "option_selected" && leftName) set({ operator: next, left: `{{vars.${leftName}.id}}`, right: choices?.[0]?.id ?? "" });
        else if (op === "option_selected" && leftName) set({ operator: next, left: `{{vars.${leftName}}}`, right: "" });
        else set({ operator: next });
      };
      const ruleOptions: ConditionOperator[] = [
        ...(choices?.length ? (["option_selected"] as const) : []),
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "is_set",
        "is_not_set",
        "matches_regex",
      ];

      return (
        <div className="space-y-5">
          <Field label="Check">
            <Chips
              value={aboutCustomer ? "customer" : "value"}
              onChange={(v) =>
                v === "customer"
                  ? set({ operator: "customer_is_new", left: "", right: "" })
                  : setLeft(firstAnswer ? `{{${firstAnswer.path}}}` : "{{vars.last_message}}")
              }
              options={[
                { value: "value", label: "An answer or value" },
                { value: "customer", label: "The customer" },
              ]}
            />
          </Field>
          {aboutCustomer ? (
            <>
              <Field label="Condition">
                <SelectField
                  value={op}
                  onChange={(v) => set({ operator: v, right: v === "has_open_enquiry" ? "30" : "" })}
                  options={CUSTOMER_OPERATORS.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))}
                />
              </Field>
              {op === "has_open_enquiry" && (
                <Field label="Only count enquiries from the last" help="An enquiry counts while its lead is New, Qualified or Contacted. Mark it Won, Lost or Closed in Leads to let the customer start again. Leave empty for no time limit.">
                  <NumberField
                    value={str("right").trim() ? Number(str("right")) || null : null}
                    onChange={(v) => set({ right: v === null ? "" : String(v) })}
                    min={1}
                    max={365}
                    allowNull
                    placeholder="Any time"
                    suffix="days"
                  />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Value">
                <PickOrCustom
                  value={leftValue}
                  onChange={setLeft}
                  options={templateOptions(variables)}
                  placeholder="Choose an answer…"
                  customPlaceholder="{{vars.name}}"
                />
              </Field>
              <Field label="Rule">
                <SelectField value={op} onChange={setOperator} options={ruleOptions.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))} />
              </Field>
              {op === "option_selected" && choices?.length ? (
                <Field label="Option">
                  <SelectField
                    value={str("right")}
                    onChange={(v) => set({ right: v })}
                    placeholder="Choose an option…"
                    options={choices.map((o) => ({ value: o.id, label: o.title || o.id }))}
                  />
                </Field>
              ) : (
                needsValue && (
                  <Field label={op === "matches_regex" ? "Pattern" : "Compare with"} error={errors.get("right")}>
                    <TextField
                      value={str("right")}
                      onChange={(v) => set({ right: v })}
                      className={op === "matches_regex" ? "font-mono text-xs" : undefined}
                      placeholder={op === "matches_regex" ? "^[0-9]{6}$" : "Text to compare"}
                    />
                  </Field>
                )
              )}
              {needsValue && op !== "option_selected" && (
                <SwitchField label="Match upper/lower case exactly" checked={bool("caseSensitive")} onChange={(v) => set({ caseSensitive: v })} />
              )}
            </>
          )}
          <Branches nodeId={nodeId} type={type} definition={definition} />
        </div>
      );
    }

    case "save_lead": {
      const mapping = (c.mapping as Record<string, string>) ?? {};
      const qualify = (c.qualifyWhen as string[]) ?? [];
      const fields = ["name", "business_name", "service", "requirements", "email"] as const;
      const options = templateOptions(variables);
      return (
        <div className="space-y-5">
          <Section title="Lead fields">
            {fields.map((f) => (
              <Field key={f} label={LEAD_FIELD_LABELS[f]}>
                <PickOrCustom
                  value={mapping[f] ?? ""}
                  onChange={(v) => set({ mapping: { ...mapping, [f]: v } })}
                  options={options}
                  emptyLabel="Not saved"
                  customPlaceholder={`{{vars.${f}}}`}
                />
              </Field>
            ))}
          </Section>
          <Field label="Mark as qualified when these are filled in">
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f) => {
                const on = qualify.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => set({ qualifyWhen: on ? qualify.filter((x) => x !== f) : [...qualify, f] })}
                    className={cn("rounded-full border px-3 py-1 text-xs transition-colors", on ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
                  >
                    {LEAD_FIELD_LABELS[f]}
                  </button>
                );
              })}
            </div>
          </Field>
          <SwitchField
            label="Update the customer's profile"
            help="Remember their name and business for next time."
            checked={bool("updateContact")}
            onChange={(v) => set({ updateContact: v })}
          />
        </div>
      );
    }

    case "crm_webhook":
      return (
        <div className="space-y-4">
          {crm.length === 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
              No CRM connected yet. The lead is still saved here.
              <Button variant="outline" size="xs" asChild>
                <a href="/crm" target="_blank" rel="noreferrer">
                  Set up CRM <ExternalLink />
                </a>
              </Button>
            </div>
          ) : (
            <Field label="Send to">
              <SelectField
                value={str("integrationId") || "__all"}
                onChange={(v) => set({ integrationId: v === "__all" ? null : v })}
                options={[
                  { value: "__all", label: "All enabled CRMs" },
                  ...crm.map((i) => ({ value: i.id, label: `${i.name}${i.enabled ? "" : " (disabled)"}` })),
                ]}
              />
            </Field>
          )}
          <Note>The lead is saved here first. Failed deliveries are retried automatically, so no lead is lost.</Note>
        </div>
      );

    case "handoff":
      return (
        <div className="space-y-4">
          <Field label="Message to the customer (optional)">
            <MessageField value={str("message")} onChange={(v) => set({ message: v })} rows={3} />
          </Field>
          <Field label="Note for your team">
            <TextField value={str("reason")} onChange={(v) => set({ reason: v })} maxLength={200} />
          </Field>
          <Note>The bot stops here and the chat appears in Conversations → Needs reply.</Note>
        </div>
      );

    case "end":
      return <Note>The flow finishes here. The customer can start it again by messaging later.</Note>;
  }
}
