"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
      <Label className="text-xs">{label}</Label>
      {children}
      {help && !error && <p className="text-[11px] text-muted-foreground">{help}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  return <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" {...rest} />;
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  allowNull,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  allowNull?: boolean;
}) {
  return (
    <Input
      type="number"
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(allowNull ? null : (min ?? 0));
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="h-8 text-sm"
    />
  );
}

export function MessageField({
  value,
  onChange,
  rows = 4,
  maxLength = 4096,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <div>
      <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={rows} maxLength={maxLength} className="text-sm" />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>
          Variables: <code>{"{{contact.name|there}}"}</code> <code>{"{{vars.name}}"}</code>
        </span>
        <span>
          {(value ?? "").length}/{maxLength}
        </span>
      </div>
    </div>
  );
}

export function SwitchField({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-medium">{label}</div>
        {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="w-full text-sm">
        <SelectValue placeholder={placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
