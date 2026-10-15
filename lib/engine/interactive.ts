import type { InteractiveConfig, InteractiveOption } from "./schema";
import type { OutboundMessage, InboundInput } from "./types";
import { renderTemplate, type TemplateScope } from "./template";

/** WhatsApp Cloud API limits for interactive messages. */
export const WA_LIMITS = {
  maxButtons: 3,
  buttonTitle: 20,
  maxListRows: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listButtonText: 20,
  body: 1024,
  headerText: 60,
  footerText: 60,
} as const;

export type ResolvedMode = "buttons" | "list" | "text";

export function resolveInteractiveMode(cfg: InteractiveConfig): ResolvedMode {
  const fitsButtons =
    cfg.options.length <= WA_LIMITS.maxButtons &&
    cfg.options.every((o) => o.title.length <= WA_LIMITS.buttonTitle);
  if (cfg.mode === "text") return "text";
  if (cfg.mode === "buttons") return fitsButtons ? "buttons" : "list";
  if (cfg.mode === "list") return cfg.options.length <= WA_LIMITS.maxListRows ? "list" : "text";
  // auto
  if (fitsButtons) return "buttons";
  if (cfg.options.length <= WA_LIMITS.maxListRows) return "list";
  return "text";
}

export function numberedOptionsText(options: InteractiveOption[]): string {
  return options.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
}

export function buildInteractiveMessage(cfg: InteractiveConfig, scope: TemplateScope): OutboundMessage {
  const body = renderTemplate(cfg.body, scope).slice(0, WA_LIMITS.body);
  const header = renderTemplate(cfg.header, scope).slice(0, WA_LIMITS.headerText) || undefined;
  const footer = renderTemplate(cfg.footer, scope).slice(0, WA_LIMITS.footerText) || undefined;
  const mode = resolveInteractiveMode(cfg);

  if (mode === "buttons") {
    return {
      kind: "buttons",
      body,
      header,
      footer,
      buttons: cfg.options.map((o) => ({ id: o.id, title: o.title })),
    };
  }
  if (mode === "list") {
    return {
      kind: "list",
      body,
      header,
      footer,
      buttonText: cfg.buttonText,
      rows: cfg.options.map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description || undefined,
      })),
    };
  }
  const text = [header, body, "", numberedOptionsText(cfg.options), footer ? `\n${footer}` : ""]
    .filter((p) => p !== undefined)
    .join("\n")
    .trim();
  return { kind: "text", text };
}

export interface OptionAnswer {
  id: string | null;
  title: string | null;
  index: number | null;
  raw: string;
  matched: boolean;
}

function normalise(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Match a customer reply against options: by reply id, by number (1-based) or by title. */
export function matchOption(options: InteractiveOption[], input: InboundInput): OptionAnswer {
  const raw = (input.replyTitle ?? input.text ?? "").trim();

  if (input.replyId) {
    const idx = options.findIndex((o) => o.id === input.replyId);
    if (idx >= 0) {
      return { id: options[idx].id, title: options[idx].title, index: idx + 1, raw, matched: true };
    }
  }

  const text = (input.text ?? "").trim();
  const num = /^(?:#|no\.?\s*|option\s*)?(\d{1,2})\s*[.)]?$/i.exec(text);
  if (num) {
    const n = Number(num[1]);
    if (n >= 1 && n <= options.length) {
      const o = options[n - 1];
      return { id: o.id, title: o.title, index: n, raw, matched: true };
    }
    return { id: null, title: null, index: null, raw, matched: false };
  }

  const norm = normalise(text);
  if (norm.length > 0) {
    const idx = options.findIndex((o) => normalise(o.title) === norm);
    if (idx >= 0) {
      return { id: options[idx].id, title: options[idx].title, index: idx + 1, raw, matched: true };
    }
  }
  return { id: null, title: null, index: null, raw, matched: false };
}

// ---------------------------------------------------------------------------
// Multiple choice: the list is re-sent after each tap with the picks ticked,
// until the customer taps Done (or reaches the maximum). Typed numbers such as
// "1, 3" or titles separated by commas select several options at once.
// ---------------------------------------------------------------------------

export const DONE_ID = "__done";
/** One list row is kept for "Done". */
export const MAX_MULTI_OPTIONS = WA_LIMITS.maxListRows - 1;

export interface MultiAnswer extends OptionAnswer {
  multi: true;
  ids: string[];
  titles: string[];
  /** True once the customer finished choosing. */
  done: boolean;
}

export function isMultiAnswer(v: unknown): v is MultiAnswer {
  return typeof v === "object" && v !== null && (v as MultiAnswer).multi === true;
}

function multiAnswer(options: InteractiveOption[], ids: string[], raw: string, done: boolean): MultiAnswer {
  const picked = options.filter((o) => ids.includes(o.id));
  return {
    multi: true,
    ids: picked.map((o) => o.id),
    titles: picked.map((o) => o.title),
    id: picked.map((o) => o.id).join(","),
    title: picked.map((o) => o.title).join(", "),
    index: null,
    raw,
    matched: done,
    done,
  };
}

/** The list (or numbered text) for a multiple-choice question, with current picks ticked. */
export function buildMultiMessage(cfg: InteractiveConfig, scope: TemplateScope, selected: string[], notice?: string): OutboundMessage {
  const header = renderTemplate(cfg.header, scope).slice(0, WA_LIMITS.headerText) || undefined;
  const footer = renderTemplate(cfg.footer, scope).slice(0, WA_LIMITS.footerText) || undefined;
  const picked = cfg.options.filter((o) => selected.includes(o.id)).map((o) => o.title);
  const status = picked.length ? `Selected: ${picked.join(", ")}` : cfg.minSelect > 1 ? `Choose at least ${cfg.minSelect}.` : "";
  const body = [renderTemplate(cfg.body, scope), status && `\n${status}`, notice && `\n${notice}`].filter(Boolean).join("\n").slice(0, WA_LIMITS.body);
  if (cfg.mode === "text" || cfg.options.length > MAX_MULTI_OPTIONS) {
    const lines = cfg.options.map((o, i) => `${selected.includes(o.id) ? "✅" : "▫️"} ${i + 1}. ${o.title}`);
    const text = [header, body, "", ...lines, "", `Reply with the numbers (e.g. 1,3), then DONE.`, footer].filter((p) => p !== undefined).join("\n").trim();
    return { kind: "text", text };
  }
  return {
    kind: "list",
    body,
    header,
    footer,
    buttonText: cfg.buttonText,
    rows: [
      ...cfg.options.map((o) => {
        const on = selected.includes(o.id);
        return {
          id: o.id,
          title: on && o.title.length <= WA_LIMITS.listRowTitle - 2 ? `✓ ${o.title}` : o.title,
          description: on ? "Selected · tap to remove" : o.description || undefined,
        };
      }),
      { id: DONE_ID, title: cfg.doneText.slice(0, WA_LIMITS.listRowTitle), description: picked.length ? `Finish with ${picked.length} selected` : "Finish choosing" },
    ],
  };
}

const DONE_WORDS = new Set(["done", "finish", "finished", "ok", "okay", "that s all", "thats all", "submit", "next"]);

/** Applies one customer reply to a multiple-choice question. */
export function applyMultiReply(
  cfg: InteractiveConfig,
  current: unknown,
  input: InboundInput,
): { answer: MultiAnswer; done: boolean; notice?: string } {
  const raw = (input.replyTitle ?? input.text ?? "").trim();
  let ids = isMultiAnswer(current) ? [...current.ids] : [];
  const max = cfg.maxSelect ?? cfg.options.length;
  const finish = (notice?: string) => {
    if (ids.length >= cfg.minSelect) return { answer: multiAnswer(cfg.options, ids, raw, true), done: true };
    return { answer: multiAnswer(cfg.options, ids, raw, false), done: false, notice: notice ?? `Please choose at least ${cfg.minSelect}.` };
  };
  const pending = (notice?: string) => ({ answer: multiAnswer(cfg.options, ids, raw, false), done: false, notice });

  if (input.replyId === DONE_ID || (!input.replyId && DONE_WORDS.has(normalise(raw)))) return finish();

  const tapped = input.replyId ? cfg.options.find((o) => o.id === input.replyId) : undefined;
  if (tapped) {
    ids = ids.includes(tapped.id) ? ids.filter((x) => x !== tapped.id) : [...ids, tapped.id];
    if (ids.length > max) {
      ids = ids.filter((x) => x !== tapped.id);
      return pending(`You can choose up to ${max}. Tap ${cfg.doneText} to continue.`);
    }
    return ids.length === max && cfg.maxSelect !== null ? finish() : pending();
  }

  // Typed: "1, 3" / "1 and 3" / "Website, Ads"
  const text = raw.replace(/\b(and|&)\b/gi, ",");
  const parts = text.split(/[,;\n]+|\s+(?=\d)/).map((p) => p.trim()).filter(Boolean);
  const chosen: string[] = [];
  for (const p of parts) {
    const n = /^#?(\d{1,2})[.)]?$/.exec(p);
    const o = n ? cfg.options[Number(n[1]) - 1] : cfg.options.find((x) => normalise(x.title) === normalise(p));
    if (!o) return pending(`Please tap the options you want, then ${cfg.doneText}. You can also type their numbers, like 1,3.`);
    if (!chosen.includes(o.id)) chosen.push(o.id);
  }
  if (!chosen.length) return pending();
  if (chosen.length > max) return pending(`You can choose up to ${max}.`);
  ids = chosen;
  return finish();
}
