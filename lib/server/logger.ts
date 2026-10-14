import type { EngineLogger } from "@/lib/engine/types";

const SENSITIVE = /(token|secret|password|authorization|signature|api[_-]?key)/i;

function scrub(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  return out;
}

/** Structured JSON logs (one line per event) without secrets. */
export function createLogger(scope: string): EngineLogger {
  const write = (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...scrub(meta) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}
