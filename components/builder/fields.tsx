"use client";

import { createContext, useContext, useRef, useState } from "react";
import { Braces, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FlowVariable } from "@/lib/engine/variables";
import { cn } from "@/lib/utils";

/** Variables the selected node can reference; provided by the properties panel. */
export const VariablesContext = createContext<FlowVariable[]>([]);

const INPUT = "h-9 rounded-xl text-sm";

export function Field({
  label,
  help,
  error,
  children,
  className,
}: {
  label: string;
  help?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[13px] font-medium">{label}</Label>
      {children}
      {help && !error && <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** A titled group of fields inside the properties panel. */
export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Collapsed-by-default group for rarely used settings. */
export function Advanced({ children, label = "Advanced" }: { children: React.ReactNode; label?: string }) {
  return (
    <Collapsible className="group/adv rounded-2xl border">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] font-medium">
        {label}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]/adv:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-3.5 pt-3 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Muted explanatory note. */
export function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" }) {
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2.5 text-xs leading-relaxed",
        tone === "warning" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  className,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  return <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={cn(INPUT, className)} {...rest} />;
}

/** Whole-number input that keeps what you type and only commits (clamped) on blur or Enter. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  allowNull,
  placeholder,
  suffix,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  allowNull?: boolean;
  placeholder?: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (raw === "" || raw === "-") {
      onChange(allowNull ? null : (min ?? 0));
      return;
    }
    let n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onChange(n);
  };
  return (
    <div className="relative">
      <Input
        inputMode="numeric"
        value={draft ?? (value ?? "")}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d-]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={cn(INPUT, "tabular-nums", suffix && "pr-14")}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/** Popover listing the flow's variables; `onPick` receives the template path, e.g. "vars.name". */
export function VariableMenu({ onPick, children }: { onPick: (path: string) => void; children: React.ReactNode }) {
  const variables = useContext(VariablesContext);
  const [open, setOpen] = useState(false);
  const groups = (["Answers", "Customer", "Messages"] as const).map((g) => [g, variables.filter((v) => v.group === g)] as const);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command className="rounded-2xl! p-1.5">
          <CommandInput placeholder="Search variables…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No variables.</CommandEmpty>
            {groups.map(([group, items]) =>
              items.length ? (
                <CommandGroup key={group} heading={group === "Answers" ? "Answers from this flow" : group}>
                  {items.map((v) => (
                    <CommandItem
                      key={v.path}
                      value={`${v.label} ${v.path}`}
                      onSelect={() => {
                        setOpen(false);
                        onPick(v.path);
                      }}
                      className="rounded-xl!"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{v.label}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{`{{${v.path}}}`}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Message textarea with an "Insert variable" menu and a character count. */
export function MessageField({
  value,
  onChange,
  rows = 4,
  maxLength = 4096,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (path: string) => {
    const el = ref.current;
    const current = value ?? "";
    const token = path === "contact.name" ? "{{contact.name|there}}" : `{{${path}}}`;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    onChange((current.slice(0, start) + token + current.slice(end)).slice(0, maxLength));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <Textarea
        ref={ref}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        className="resize-y rounded-none border-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center justify-between border-t bg-muted/40 px-2 py-1">
        <VariableMenu onPick={insert}>
          <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <Braces className="size-3.5" /> Insert variable
          </button>
        </VariableMenu>
        <span className="px-1 text-[11px] text-muted-foreground tabular-nums">
          {(value ?? "").length}/{maxLength}
        </span>
      </div>
    </div>
  );
}

export function SwitchField({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        {help && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{help}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  group?: string;
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
}) {
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="w-full text-sm">
        <SelectValue placeholder={placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {groups.map((g, i) => (
          <SelectGroup key={g || i}>
            {i > 0 && <SelectSeparator />}
            {g && <SelectLabel>{g}</SelectLabel>}
            {options
              .filter((o) => (o.group ?? "") === g)
              .map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const NONE = "__none";
const CUSTOM = "__custom";

/**
 * Pick a value from a list (usually variables) with an optional "Custom…" escape hatch
 * that reveals a free-text input. `""` is shown as `emptyLabel` when given.
 */
export function PickOrCustom({
  value,
  onChange,
  options,
  emptyLabel,
  customPlaceholder,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  emptyLabel?: string;
  customPlaceholder?: string;
  placeholder?: string;
}) {
  const known = options.some((o) => o.value === value);
  const [custom, setCustom] = useState(() => Boolean(value) && !known);
  const showCustom = custom || (Boolean(value) && !known);
  const selected = showCustom ? CUSTOM : value ? value : emptyLabel ? NONE : "";
  return (
    <div className="space-y-2">
      <SelectField
        value={selected}
        placeholder={placeholder}
        onChange={(v) => {
          if (v === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(v === NONE ? "" : v);
        }}
        options={[
          ...(emptyLabel ? [{ value: NONE, label: emptyLabel }] : []),
          ...options,
          { value: CUSTOM, label: "Custom…", group: "Other" },
        ]}
      />
      {showCustom && <TextField value={value} onChange={onChange} placeholder={customPlaceholder} className="font-mono text-xs" autoFocus={custom && !value} />}
    </div>
  );
}

/** Small pill choices, e.g. presets or a two-way toggle. */
export function Chips<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            value === o.value ? "border-foreground bg-foreground font-medium text-background" : "hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Words as removable chips; Enter or comma adds, Backspace on an empty input removes the last. */
export function TagInput({ value, onChange, placeholder, max = 30 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const words = raw
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean)
      .filter((w) => !value.some((v) => v.toLowerCase() === w.toLowerCase()));
    if (words.length) onChange([...value, ...words].slice(0, max));
    setText("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-xl border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      {value.map((w) => (
        <span key={w} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs">
          {w}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== w))} className="rounded-full p-0.5 hover:bg-background" aria-label={`Remove ${w}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
