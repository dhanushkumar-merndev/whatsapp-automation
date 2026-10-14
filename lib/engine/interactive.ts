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
