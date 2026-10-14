import type { ValidationConfig } from "./schema";
import type { OptionAnswer } from "./interactive";

export type ValidationOutcome = { valid: true } | { valid: false; reason: string };

const PRESETS: Record<Exclude<ValidationConfig["preset"], "none">, RegExp> = {
  name: /^[\p{L}][\p{L}\p{M}' .-]{0,79}$/u,
  business_name: /^(?=.*[\p{L}\p{N}]).{2,120}$/su,
  email: /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/,
  phone: /^\+?[0-9][0-9 ()-]{5,19}$/,
};

export function isOptionAnswer(v: unknown): v is OptionAnswer {
  return typeof v === "object" && v !== null && "matched" in v && "raw" in v;
}

/** Validate a stored answer. Interactive answers are checked against option ids. */
export function validateAnswer(cfg: ValidationConfig, value: unknown): ValidationOutcome {
  if (isOptionAnswer(value)) {
    if (!value.matched || !value.id) return { valid: false, reason: "not_an_option" };
    if (cfg.allowedOptionIds.length > 0 && !cfg.allowedOptionIds.includes(value.id)) {
      return { valid: false, reason: "option_not_allowed" };
    }
    return { valid: true };
  }

  const s = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  if (!s) return cfg.required ? { valid: false, reason: "required" } : { valid: true };
  if (cfg.minLength !== null && s.length < cfg.minLength) return { valid: false, reason: "too_short" };
  if (cfg.maxLength !== null && s.length > cfg.maxLength) return { valid: false, reason: "too_long" };
  if (cfg.allowedOptionIds.length > 0 && !cfg.allowedOptionIds.includes(s)) {
    return { valid: false, reason: "option_not_allowed" };
  }
  if (cfg.preset !== "none" && !PRESETS[cfg.preset].test(s)) return { valid: false, reason: `invalid_${cfg.preset}` };
  if (cfg.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(cfg.pattern, "u");
    } catch {
      return { valid: false, reason: "invalid_pattern_config" };
    }
    if (!re.test(s.slice(0, 4096))) return { valid: false, reason: "pattern_mismatch" };
  }
  return { valid: true };
}

/** Returns an error message if the regex in a validation node cannot compile. */
export function checkPattern(pattern: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern, "u");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid regular expression";
  }
}
