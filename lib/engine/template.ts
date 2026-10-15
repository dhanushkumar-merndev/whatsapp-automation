/**
 * Minimal, safe template rendering for message text.
 *   {{contact.name}}            → value or empty string
 *   {{contact.name|there}}      → value or the fallback "there"
 *   {{vars.service}}            → an interactive answer renders as its title
 *   {{vars.service.id}}         → the selected option id
 * No code execution, no HTML — WhatsApp messages are plain text.
 */

export type TemplateScope = Record<string, unknown>;

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export function lookup(scope: TemplateScope, path: string): unknown {
  let cur: unknown = scope;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.title === "string") return v.title;
    if (typeof v.raw === "string") return v.raw;
  }
  return "";
}

/** `escape` is applied to each inserted value, e.g. for URLs or JSON bodies. */
export function renderTemplate(template: string, scope: TemplateScope, escape: (value: string) => string = (v) => v): string {
  return template.replace(TOKEN, (_m, path: string, fallback?: string) => {
    const value = stringify(lookup(scope, path)).trim();
    return escape(value.length > 0 ? value : (fallback ?? ""));
  });
}

/** Escapes a value for use inside a JSON string literal. */
export const jsonEscape = (v: string) => JSON.stringify(v).slice(1, -1);

/** Lists variables referenced by a template, e.g. ["contact.name", "vars.service"]. */
export function templateVariables(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TOKEN)) out.push(m[1]);
  return out;
}
