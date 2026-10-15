"use client";

import { useEffect, useState } from "react";
import { listTemplatesAction } from "@/app/(dashboard)/flows/actions";
import type { MessageTemplate } from "@/lib/whatsapp/graph";
import { Field, Note, SelectField, TextField } from "./fields";

type Loaded = { ok: true; templates: MessageTemplate[] } | { ok: false; error: string };
// One request per page load; every template field shares it.
let request: Promise<Loaded> | null = null;

export function useTemplates(): Loaded | null {
  const [state, setState] = useState<Loaded | null>(null);
  useEffect(() => {
    request ??= listTemplatesAction()
      .then((r): Loaded => (r.ok ? { ok: true, templates: r.data ?? [] } : { ok: false, error: r.error }))
      .catch((): Loaded => ({ ok: false, error: "Couldn't load templates" }));
    let live = true;
    void request.then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** Choose an approved template; falls back to typing its name when the list can't be loaded. */
export function TemplatePicker({
  name,
  language,
  onChange,
}: {
  name: string;
  language: string;
  onChange: (v: { name: string; language: string; template?: MessageTemplate }) => void;
}) {
  const loaded = useTemplates();
  const templates = loaded?.ok ? loaded.templates : [];
  const current = templates.find((t) => t.name === name && t.language === language);
  if (loaded && (!loaded.ok || templates.length === 0)) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label="Template name">
            <TextField value={name} onChange={(v) => onChange({ name: v.trim(), language })} placeholder="appointment_reminder" />
          </Field>
          <Field label="Language">
            <TextField value={language} onChange={(v) => onChange({ name, language: v.trim() })} placeholder="en" />
          </Field>
        </div>
        <Note tone="warning">
          {loaded.ok ? "No approved templates found." : loaded.error} Create one in WhatsApp Manager → Message templates, wait for approval, then type its name.
        </Note>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <SelectField
        value={current ? `${current.name}|${current.language}` : ""}
        onChange={(v) => {
          const t = templates.find((x) => `${x.name}|${x.language}` === v);
          if (t) onChange({ name: t.name, language: t.language, template: t });
        }}
        placeholder={loaded ? "Choose an approved template…" : "Loading templates…"}
        options={templates.map((t) => ({ value: `${t.name}|${t.language}`, label: `${t.name} · ${t.language}`, group: t.category }))}
      />
      {current?.body && <p className="rounded-xl bg-muted/60 p-2.5 text-xs whitespace-pre-wrap">{current.body}</p>}
    </div>
  );
}
