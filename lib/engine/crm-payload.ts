import type { LeadRecord } from "./types";

/** Canonical lead fields available for CRM mapping. */
export const CRM_SOURCE_FIELDS = [
  "lead_id",
  "name",
  "phone",
  "business_name",
  "service",
  "service_id",
  "requirements",
  "email",
  "source",
  "status",
  "created_at",
  "updated_at",
  "flow_id",
  "conversation_id",
  "is_test",
] as const;
export type CrmSourceField = (typeof CRM_SOURCE_FIELDS)[number];

export const DEFAULT_CRM_MAPPING: Record<CrmSourceField, string> = Object.fromEntries(
  CRM_SOURCE_FIELDS.map((f) => [f, f]),
) as Record<CrmSourceField, string>;

export function leadCanonicalFields(lead: LeadRecord): Record<CrmSourceField, unknown> {
  return {
    lead_id: lead.id,
    name: lead.name,
    phone: lead.phone.startsWith("+") ? lead.phone : `+${lead.phone}`,
    business_name: lead.businessName,
    service: lead.service,
    service_id: lead.serviceId,
    requirements: lead.requirements,
    email: lead.email,
    source: "WhatsApp",
    status: lead.status,
    created_at: lead.createdAt,
    updated_at: lead.updatedAt,
    flow_id: lead.flowId,
    conversation_id: lead.conversationId,
    is_test: lead.isTest,
  };
}

/**
 * Build the CRM event. `mapping` maps canonical field → destination key;
 * an empty destination key omits the field.
 */
export function buildCrmPayload(input: {
  lead: LeadRecord;
  eventId: string;
  eventType: string;
  mapping: Record<string, string>;
  occurredAt: string;
}): Record<string, unknown> {
  const canonical = leadCanonicalFields(input.lead);
  const mapping = { ...DEFAULT_CRM_MAPPING, ...input.mapping };
  const data: Record<string, unknown> = {};
  for (const field of CRM_SOURCE_FIELDS) {
    const key = (mapping[field] ?? "").trim();
    if (key) data[key] = canonical[field] ?? null;
  }
  return {
    event_id: input.eventId,
    event_type: input.eventType,
    occurred_at: input.occurredAt,
    data,
  };
}

export function leadSubmittedEventId(leadId: string) {
  return `lead.submitted:${leadId}`;
}
