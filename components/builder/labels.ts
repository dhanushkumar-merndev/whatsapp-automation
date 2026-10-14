import type { CONDITION_OPERATORS, LEAD_FIELDS } from "@/lib/engine/schema";

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const LEAD_FIELD_LABELS: Record<(typeof LEAD_FIELDS)[number], string> = {
  none: "Don't save on the lead",
  name: "Name",
  business_name: "Business name",
  service: "Service",
  requirements: "Requirements",
  email: "Email",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  is_set: "is filled in",
  is_not_set: "is empty",
  matches_regex: "matches pattern",
  option_selected: "picked option",
  customer_is_new: "Customer is new",
  customer_is_returning: "Customer is returning",
  has_open_enquiry: "Customer has an open enquiry",
};

/** Operators about the customer; they ignore "value to test". */
export const CUSTOMER_OPERATORS: ConditionOperator[] = ["customer_is_new", "customer_is_returning", "has_open_enquiry"];
/** Operators that compare against "Compare with". */
export const VALUE_OPERATORS: ConditionOperator[] = ["equals", "not_equals", "contains", "not_contains", "matches_regex", "option_selected"];

/** Turns template references into readable words: "{{vars.service.id}}" → "service", "{{contact.name}}" → "customer name". */
export function prettyRef(template: string): string {
  return template
    .replace(/\{\{\s*vars\.([a-z0-9_]+)(?:\.id)?\s*(?:\|[^}]*)?\}\}/gi, (_m, v: string) => v.replace(/_/g, " "))
    .replace(/\{\{\s*contact\.([a-z0-9_]+)\s*(?:\|[^}]*)?\}\}/gi, (_m, v: string) => `customer ${v.replace(/_/g, " ")}`)
    .trim();
}

export function waitLabel(amount: unknown, unit: unknown): string {
  const n = typeof amount === "number" ? amount : 0;
  const u = typeof unit === "string" ? unit : "seconds";
  return `${n} ${n === 1 ? u.replace(/s$/, "") : u}`;
}
