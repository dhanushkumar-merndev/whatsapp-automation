-- =============================================================================
-- Star Growth Hub — WhatsApp automation platform: core schema
-- =============================================================================

-- Generic updated_at trigger ---------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- 1. profiles: authorised administrators -------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  -- Optional non-email login ID (e.g. "Gayathri@2026"); mapped to an internal auth email.
  login_id text,
  full_name text,
  role text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  mfa_enrolled_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create unique index profiles_login_id_key on public.profiles (lower(login_id)) where login_id is not null;

-- app_settings: singleton JSON settings row -----------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 2. whatsapp_accounts ---------------------------------------------------------
create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text,
  verified_name text,
  quality_rating text,
  enabled boolean not null default true,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. contacts --------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique check (wa_id ~ '^[0-9]{6,20}$'),
  profile_name text,
  name text,
  business_name text,
  email text,
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  cooldown_until timestamptz,
  is_test boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. conversations -------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  account_id uuid not null references public.whatsapp_accounts (id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'handoff', 'closed')),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  is_test boolean not null default false,
  handoff_reason text,
  handoff_at timestamptz,
  assigned_to uuid references public.profiles (id) on delete set null,
  lock_token uuid,
  lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, account_id)
);
create index conversations_last_inbound_idx on public.conversations (last_inbound_at desc);
create index conversations_status_idx on public.conversations (status);

-- 10. media_assets (needed before messages) ------------------------------------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('image', 'document', 'video')),
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text not null unique,
  checksum_sha256 text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  rejection_reason text,
  meta_media_id text,
  meta_media_uploaded_at timestamptz,
  meta_phone_number_id text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. flows -----------------------------------------------------------------------
create table public.flows (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text,
  status text not null default 'draft' check (status in ('draft', 'testing', 'active', 'paused', 'archived')),
  draft_definition jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  draft_updated_at timestamptz not null default now(),
  published_version_id uuid,
  priority integer not null default 100,
  estimate_snapshot jsonb,
  is_default boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flows_status_idx on public.flows (status);

-- 7. flow_versions: immutable published definitions -----------------------------
create table public.flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows (id) on delete cascade,
  version integer not null check (version > 0),
  definition jsonb not null,
  estimate_report jsonb,
  note text,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (flow_id, version)
);
alter table public.flows
  add constraint flows_published_version_fk
  foreign key (published_version_id) references public.flow_versions (id) on delete set null;

create or replace function public.prevent_flow_version_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Only the ON DELETE SET NULL of published_by (user removal) may touch a version.
  if new.id is distinct from old.id
     or new.flow_id is distinct from old.flow_id
     or new.version is distinct from old.version
     or new.definition is distinct from old.definition
     or new.estimate_report is distinct from old.estimate_report
     or new.note is distinct from old.note
     or new.created_at is distinct from old.created_at
     or new.published_by is not null then
    raise exception 'flow_versions are immutable; publish a new version instead'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger flow_versions_immutable
  before update on public.flow_versions
  for each row execute function public.prevent_flow_version_update();

-- 8. flow_executions ---------------------------------------------------------------
create table public.flow_executions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows (id) on delete cascade,
  flow_version_id uuid not null references public.flow_versions (id) on delete restrict,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status text not null default 'running' check (status in (
    'running', 'waiting_input', 'waiting_delay', 'completed', 'handoff',
    'window_expired', 'failed', 'cancelled', 'paused', 'abandoned')),
  current_node_id text,
  step integer not null default 0,
  context jsonb not null default '{}'::jsonb,
  awaiting jsonb,
  is_test boolean not null default false,
  error text,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one active execution per conversation: concurrent inbound messages
-- can never start two copies of a flow.
create unique index flow_executions_one_active_per_conversation
  on public.flow_executions (conversation_id)
  where status in ('running', 'waiting_input', 'waiting_delay');
create index flow_executions_flow_idx on public.flow_executions (flow_id, started_at desc);
create index flow_executions_status_idx on public.flow_executions (status, last_activity_at);
create index flow_executions_contact_idx on public.flow_executions (contact_id);

-- 9. node_executions ---------------------------------------------------------------
create table public.node_executions (
  id bigint generated always as identity primary key,
  execution_id uuid not null references public.flow_executions (id) on delete cascade,
  node_id text not null,
  node_type text not null,
  step integer not null,
  status text not null check (status in ('success', 'waiting', 'skipped', 'failed')),
  output_handle text,
  detail jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index node_executions_execution_idx on public.node_executions (execution_id, id);
create index node_executions_failed_idx on public.node_executions (created_at) where status = 'failed';

-- 5. messages ------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  wa_message_id text unique,
  idempotency_key text unique,
  type text not null,
  body text,
  payload jsonb,
  media_asset_id uuid references public.media_assets (id) on delete set null,
  status text not null,
  processing_status text check (processing_status in (
    'pending', 'processed', 'rate_limited', 'ignored', 'failed')),
  processing_note text,
  error jsonb,
  pricing_billable boolean,
  pricing_category text,
  pricing_model text,
  flow_execution_id uuid references public.flow_executions (id) on delete set null,
  node_id text,
  sent_by uuid references public.profiles (id) on delete set null,
  is_test boolean not null default false,
  provider_timestamp timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (direction = 'outbound' or wa_message_id is not null)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_pending_inbound_idx on public.messages (conversation_id, provider_timestamp, created_at)
  where direction = 'inbound' and processing_status = 'pending';
create index messages_created_idx on public.messages (created_at);
create index messages_media_recent_idx on public.messages (contact_id, media_asset_id, created_at)
  where direction = 'outbound' and media_asset_id is not null;

-- 11. leads --------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  flow_id uuid references public.flows (id) on delete set null,
  flow_version_id uuid references public.flow_versions (id) on delete set null,
  flow_execution_id uuid unique references public.flow_executions (id) on delete set null,
  name text,
  business_name text,
  service text,
  service_id text,
  requirements text,
  email text,
  phone text not null,
  answers jsonb not null default '{}'::jsonb,
  source text not null default 'whatsapp',
  status text not null default 'incomplete' check (status in (
    'incomplete', 'new', 'qualified', 'contacted', 'won', 'lost', 'closed')),
  crm_sync_status text not null default 'pending' check (crm_sync_status in (
    'not_configured', 'pending', 'synced', 'failed')),
  crm_last_synced_at timestamptz,
  assigned_to uuid references public.profiles (id) on delete set null,
  notes text,
  is_test boolean not null default false,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_created_idx on public.leads (created_at desc);
create index leads_status_idx on public.leads (status);
create index leads_crm_idx on public.leads (crm_sync_status);
create index leads_contact_idx on public.leads (contact_id);

-- 12. crm_integrations -----------------------------------------------------------------
create table public.crm_integrations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null check (url ~* '^https?://'),
  enabled boolean not null default false,
  auth_type text not null default 'none' check (auth_type in ('none', 'bearer', 'basic', 'header')),
  -- AES-256-GCM ciphertext (APP_ENCRYPTION_KEY); never returned to the browser.
  credentials_encrypted text,
  signing_secret_encrypted text,
  field_mapping jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 13. crm_deliveries --------------------------------------------------------------------
create table public.crm_deliveries (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.crm_integrations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'retrying', 'deferred')),
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  last_status_code integer,
  last_error text,
  response_excerpt text,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, event_id)
);
create index crm_deliveries_status_idx on public.crm_deliveries (status, next_attempt_at);
create index crm_deliveries_lead_idx on public.crm_deliveries (lead_id);

-- 14. scheduled_jobs --------------------------------------------------------------------
create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('flow_resume', 'crm_retry')),
  execution_id uuid references public.flow_executions (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  node_id text,
  crm_delivery_id uuid references public.crm_deliveries (id) on delete cascade,
  flow_id uuid references public.flows (id) on delete cascade,
  run_at timestamptz not null,
  status text not null default 'scheduled' check (status in (
    'scheduled', 'running', 'completed', 'cancelled', 'failed', 'skipped')),
  qstash_message_id text,
  attempts integer not null default 0,
  last_error text,
  idempotency_key text not null unique,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scheduled_jobs_status_idx on public.scheduled_jobs (status, run_at);
create index scheduled_jobs_flow_idx on public.scheduled_jobs (flow_id) where status = 'scheduled';

-- 15. usage_records ----------------------------------------------------------------------
create table public.usage_records (
  id bigint generated always as identity primary key,
  service text not null check (service in ('qstash', 'redis', 'whatsapp', 'crm', 'supabase_db', 'supabase_storage')),
  metric text not null,
  period_start date not null,
  source text not null default 'local_measured' check (source in ('local_measured', 'provider', 'estimate')),
  flow_id uuid references public.flows (id) on delete set null,
  is_test boolean not null default false,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint usage_records_unique unique nulls not distinct (service, metric, period_start, source, flow_id, is_test)
);
create index usage_records_period_idx on public.usage_records (service, metric, period_start);

-- 16. plan_limits: provider allowances and pricing versions -------------------------------
create table public.plan_limits (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('qstash', 'redis', 'supabase', 'meta_whatsapp', 'vercel')),
  metric text not null,
  period text not null check (period in ('day', 'month', 'total', 'per_message')),
  limit_value numeric,
  unit text,
  unit_price numeric,
  currency text,
  category text,
  country_code text,
  phone_number_id text,
  plan_name text,
  effective_from date not null default current_date,
  effective_to date,
  source text not null default 'manual' check (source in ('seeded', 'manual', 'provider')),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plan_limits_lookup_idx on public.plan_limits (service, metric, active);

-- 17. rate_limit_events ----------------------------------------------------------------------
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  scope text not null,
  identifier text not null,
  contact_id uuid references public.contacts (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null default 'blocked',
  detail jsonb,
  created_at timestamptz not null default now()
);
create index rate_limit_events_created_idx on public.rate_limit_events (created_at desc);

-- 18. audit_logs -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system')),
  action text not null,
  entity_type text,
  entity_id text,
  detail jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- notifications: admin alerts (window expired, handoff, failures) ----------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_unread_idx on public.notifications (created_at desc) where read_at is null;

-- updated_at triggers -------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'whatsapp_accounts', 'contacts', 'conversations', 'media_assets', 'flows',
    'flow_executions', 'messages', 'leads', 'crm_integrations', 'crm_deliveries',
    'scheduled_jobs', 'plan_limits'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t);
  end loop;
end $$;
