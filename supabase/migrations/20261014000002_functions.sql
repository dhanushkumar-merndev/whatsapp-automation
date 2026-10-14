-- =============================================================================
-- Functions: authorisation helpers and atomic server-side operations
-- =============================================================================

-- Authorisation helpers -------------------------------------------------------
-- Every dashboard data policy requires an active profile AND an AAL2 (MFA
-- verified) session. Users without verified MFA can read nothing.

create or replace function public.current_aal() returns text
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '')
$$;

create or replace function public.has_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from public.profiles p
       where p.id = (select auth.uid())
         and p.status = 'active'
         and p.role = any (p_roles)
     )
$$;

create or replace function public.is_staff() returns boolean
language sql stable set search_path = '' as $$
  select public.has_role(array['owner', 'admin', 'staff'])
$$;

create or replace function public.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select public.has_role(array['owner', 'admin'])
$$;

-- record_inbound_message -------------------------------------------------------
-- Durably records one inbound WhatsApp message in a single transaction:
-- upsert contact + conversation, refresh the service-window timestamp and
-- insert the message. The unique wa_message_id makes Meta retries no-ops.
create or replace function public.record_inbound_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ts timestamptz := coalesce((p ->> 'provider_timestamp')::timestamptz, now());
  v_is_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_new_contact boolean;
begin
  insert into public.contacts as c (wa_id, profile_name, is_test, last_seen_at)
  values (p ->> 'wa_id', nullif(p ->> 'profile_name', ''), v_is_test, v_ts)
  on conflict (wa_id) do update
    set profile_name = coalesce(excluded.profile_name, c.profile_name),
        last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at),
        is_test = c.is_test or excluded.is_test
  returning c.id, (c.xmax = 0) into v_contact_id, v_new_contact;

  insert into public.conversations as cv (contact_id, account_id, is_test, last_inbound_at)
  values (v_contact_id, (p ->> 'account_id')::uuid, v_is_test, v_ts)
  on conflict (contact_id, account_id) do update
    set last_inbound_at = greatest(cv.last_inbound_at, excluded.last_inbound_at),
        is_test = cv.is_test or excluded.is_test
  returning cv.id into v_conversation_id;

  insert into public.messages (
    conversation_id, contact_id, direction, wa_message_id, type, body, payload,
    status, processing_status, is_test, provider_timestamp)
  values (
    v_conversation_id, v_contact_id, 'inbound', p ->> 'wa_message_id', p ->> 'type',
    p ->> 'body', p -> 'payload', 'received', 'pending', v_is_test, v_ts)
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  return jsonb_build_object(
    'contact_id', v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'duplicate', v_message_id is null,
    'new_contact', v_new_contact);
end $$;

-- apply_message_status --------------------------------------------------------
-- Delivery receipts only move a message forward (sent → delivered → read);
-- "failed" always applies. Never triggers a flow.
create or replace function public.apply_message_status(
  p_wa_message_id text, p_status text, p_error jsonb,
  p_billable boolean, p_category text, p_model text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_rank_new int := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 9 else 0 end;
  v_count integer;
begin
  update public.messages m
     set status = case
           when p_status = 'failed' then 'failed'
           when v_rank_new > case m.status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 9 else 0 end
             then p_status
           else m.status end,
         error = coalesce(p_error, m.error),
         pricing_billable = coalesce(p_billable, m.pricing_billable),
         pricing_category = coalesce(p_category, m.pricing_category),
         pricing_model = coalesce(p_model, m.pricing_model)
   where m.wa_message_id = p_wa_message_id and m.direction = 'outbound';
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

-- Conversation lease lock -------------------------------------------------------
-- Serialises processing per conversation so concurrent webhooks and delayed
-- jobs never interleave state changes or duplicate replies.
create or replace function public.acquire_conversation_lock(
  p_conversation_id uuid, p_token uuid, p_ttl_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.conversations
     set lock_token = p_token,
         lock_expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = p_conversation_id
     and (lock_token is null or lock_expires_at < now() or lock_token = p_token);
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

create or replace function public.release_conversation_lock(p_conversation_id uuid, p_token uuid) returns void
language sql security definer set search_path = '' as $$
  update public.conversations
     set lock_token = null, lock_expires_at = null
   where id = p_conversation_id and lock_token = p_token
$$;

-- Outbound idempotency -----------------------------------------------------------
-- A send is claimed (row inserted as "pending") before the provider call. A
-- retried request with the same idempotency key sees the existing row and
-- does not send again.
create or replace function public.claim_outbound_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status text;
begin
  insert into public.messages (
    conversation_id, contact_id, direction, idempotency_key, type, body, payload,
    media_asset_id, status, flow_execution_id, node_id, sent_by, is_test)
  values (
    (p ->> 'conversation_id')::uuid, (p ->> 'contact_id')::uuid, 'outbound', p ->> 'idempotency_key',
    p ->> 'type', p ->> 'body', p -> 'payload', nullif(p ->> 'media_asset_id', '')::uuid, 'pending',
    nullif(p ->> 'flow_execution_id', '')::uuid, p ->> 'node_id', nullif(p ->> 'sent_by', '')::uuid,
    coalesce((p ->> 'is_test')::boolean, false))
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select status into v_status from public.messages where idempotency_key = p ->> 'idempotency_key';
    return jsonb_build_object('status', 'duplicate', 'existing_status', v_status);
  end if;
  return jsonb_build_object('status', 'new', 'message_id', v_id);
end $$;

-- Scheduled job claim ------------------------------------------------------------
-- Atomically moves a job to "running". A duplicate QStash delivery finds the
-- job already claimed and becomes a no-op. A job stuck in "running" (crashed
-- worker) can be reclaimed after two minutes.
create or replace function public.claim_scheduled_job(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.scheduled_jobs;
begin
  update public.scheduled_jobs
     set status = 'running', attempts = attempts + 1
   where id = p_job_id
     and (status = 'scheduled' or (status = 'running' and updated_at < now() - interval '2 minutes'))
  returning * into v_row;
  if not found then
    return null;
  end if;
  return to_jsonb(v_row);
end $$;

-- Usage counters -------------------------------------------------------------------
create or replace function public.increment_usage(
  p_service text, p_metric text, p_day date, p_source text,
  p_flow_id uuid, p_is_test boolean, p_quantity numeric) returns void
language sql security definer set search_path = '' as $$
  insert into public.usage_records (service, metric, period_start, source, flow_id, is_test, quantity)
  values (p_service, p_metric, p_day, p_source, p_flow_id, p_is_test, p_quantity)
  on conflict on constraint usage_records_unique
  do update set quantity = public.usage_records.quantity + excluded.quantity, updated_at = now()
$$;

-- Measured storage usage (database size + media bucket bytes) ------------------------
create or replace function public.get_storage_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_db bigint;
  v_media bigint;
  v_count bigint;
begin
  if not (public.is_staff() or coalesce((select auth.jwt()) ->> 'role', '') = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select pg_database_size(current_database()) into v_db;
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0), count(*)
    into v_media, v_count
    from storage.objects o
   where o.bucket_id = 'media';
  return jsonb_build_object('database_bytes', v_db, 'media_bytes', v_media, 'media_objects', v_count);
end $$;

-- Dashboard daily series (security invoker: RLS applies) -------------------------------
create or replace function public.dashboard_series(
  p_from timestamptz, p_to timestamptz, p_include_test boolean default false)
returns table (day date, inbound bigint, outbound bigint, leads bigint, qualified bigint)
language sql stable set search_path = '' as $$
  with days as (
    select generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day')::date as day
  ),
  m as (
    select (created_at at time zone 'utc')::date as d,
           count(*) filter (where direction = 'inbound') as i,
           count(*) filter (where direction = 'outbound' and status in ('sent', 'delivered', 'read')) as o
      from public.messages
     where created_at >= p_from and created_at < p_to + interval '1 day'
       and (p_include_test or not is_test)
     group by 1
  ),
  l as (
    select (created_at at time zone 'utc')::date as d,
           count(*) as total,
           count(*) filter (where status = 'qualified') as q
      from public.leads
     where created_at >= p_from and created_at < p_to + interval '1 day'
       and (p_include_test or not is_test)
     group by 1
  )
  select days.day, coalesce(m.i, 0), coalesce(m.o, 0), coalesce(l.total, 0), coalesce(l.q, 0)
    from days
    left join m on m.d = days.day
    left join l on l.d = days.day
   order by days.day
$$;

-- Grants: server-only functions are callable by the service role only -------------------
revoke execute on function public.record_inbound_message(jsonb) from public, anon, authenticated;
revoke execute on function public.apply_message_status(text, text, jsonb, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.acquire_conversation_lock(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_conversation_lock(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.claim_outbound_message(jsonb) from public, anon, authenticated;
revoke execute on function public.claim_scheduled_job(uuid) from public, anon, authenticated;
revoke execute on function public.increment_usage(text, text, date, text, uuid, boolean, numeric) from public, anon, authenticated;
revoke execute on function public.get_storage_usage() from public, anon;
revoke execute on function public.dashboard_series(timestamptz, timestamptz, boolean) from public, anon;
revoke execute on function public.has_role(text[]) from public, anon;
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_admin() from public, anon;

grant execute on function public.record_inbound_message(jsonb) to service_role;
grant execute on function public.apply_message_status(text, text, jsonb, boolean, text, text) to service_role;
grant execute on function public.acquire_conversation_lock(uuid, uuid, integer) to service_role;
grant execute on function public.release_conversation_lock(uuid, uuid) to service_role;
grant execute on function public.claim_outbound_message(jsonb) to service_role;
grant execute on function public.claim_scheduled_job(uuid) to service_role;
grant execute on function public.increment_usage(text, text, date, text, uuid, boolean, numeric) to service_role;
grant execute on function public.get_storage_usage() to authenticated, service_role;
grant execute on function public.dashboard_series(timestamptz, timestamptz, boolean) to authenticated, service_role;
grant execute on function public.has_role(text[]) to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
