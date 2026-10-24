/**
 * Full-data backup: which tables are exported and which can be restored.
 * Restore only ever ADDS rows that are missing; it never deletes or overwrites.
 * Shared by server and browser code (no server-only imports).
 */

export const BACKUP_FORMAT = "sgh-export";
export const BACKUP_VERSION = 1;

/** Every table in the export, parents first (this is also the restore order). */
export const BACKUP_TABLES = [
  "app_settings",
  "plan_limits",
  "whatsapp_accounts",
  "contacts",
  "business_contacts",
  "conversations",
  "media_assets",
  "flows",
  "flow_versions",
  "flow_executions",
  "node_executions",
  "messages",
  "leads",
  "bookings",
  "crm_integrations",
  "crm_deliveries",
  "scheduled_jobs",
  "usage_records",
  "notifications",
  "telegram_chats",
  "audit_logs",
  "rate_limit_events",
  "profiles",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Export-only: team accounts live in Supabase Auth, and queued jobs / CRM retries must not re-run from an old file. */
export const EXPORT_ONLY: readonly BackupTable[] = ["profiles", "scheduled_jobs", "crm_deliveries", "rate_limit_events"];

export const RESTORABLE_TABLES = BACKUP_TABLES.filter((t) => !EXPORT_ONLY.includes(t));

/** Primary key used to page through a table. */
export const PRIMARY_KEY: Partial<Record<BackupTable, string>> = { business_contacts: "wa_id" };
export const pkOf = (t: BackupTable) => PRIMARY_KEY[t] ?? "id";

/** Secrets that never leave the database (encrypted with APP_ENCRYPTION_KEY; re-enter them after a restore). */
export const OMIT_COLUMNS: Partial<Record<BackupTable, string[]>> = {
  crm_integrations: ["credentials_encrypted", "signing_secret_encrypted"],
};

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  tables: Partial<Record<BackupTable, Record<string, unknown>[]>>;
}

export function isBackupFile(v: unknown): v is BackupFile {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return f.format === BACKUP_FORMAT && typeof f.version === "number" && !!f.tables && typeof f.tables === "object";
}
