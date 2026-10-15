-- =============================================================================
-- Coexistence: the same number in the WhatsApp Business app and the Cloud API.
--   * Messages you send from the phone app arrive as "echoes": they are stored
--     as outbound messages and (by default) hand the chat to a human.
--   * Chat history (up to 6 months) and phone contacts can be imported once.
--   * Each number can carry its own (encrypted) access token from onboarding.
-- =============================================================================

alter table public.whatsapp_accounts
  add column access_token_encrypted text,
  add column coexistence boolean not null default false,
  add column is_on_biz_app boolean,
  add column onboarded_at timestamptz,
  add column contacts_sync_requested_at timestamptz,
  add column history_sync_requested_at timestamptz;

-- The token never leaves the server: dashboard users read and write every column but it.
revoke select, insert, update on public.whatsapp_accounts from authenticated;
grant select (id, name, waba_id, phone_number_id, display_phone_number, verified_name, quality_rating, enabled,
              last_verified_at, metadata, coexistence, is_on_biz_app, onboarded_at, contacts_sync_requested_at,
              history_sync_requested_at, created_at, updated_at)
  on public.whatsapp_accounts to authenticated;
grant insert (name, waba_id, phone_number_id, enabled) on public.whatsapp_accounts to authenticated;
grant update (name, waba_id, phone_number_id, enabled, display_phone_number, verified_name, quality_rating, last_verified_at, metadata)
  on public.whatsapp_accounts to authenticated;

alter table public.messages
  add column source text check (source in ('customer', 'bot', 'team', 'business_app', 'history'));

alter table public.conversations
  add column handoff_by text check (handoff_by in ('customer', 'flow', 'team', 'business_app', 'telegram')),
  add column human_last_reply_at timestamptz;

alter table public.contacts add column saved_name text;

-- Names from the business's phone contacts (smb_app_state_sync), kept even for
-- people who have not messaged yet, so a later first message gets the name.
create table public.business_contacts (
  wa_id text primary key check (wa_id ~ '^[0-9]{6,20}$'),
  full_name text,
  first_name text,
  updated_at timestamptz not null default now()
);
alter table public.business_contacts enable row level security;
create policy business_contacts_require_mfa on public.business_contacts as restrictive for all to authenticated
  using (public.current_aal() = 'aal2') with check (public.current_aal() = 'aal2');
create policy business_contacts_staff_read on public.business_contacts for select to authenticated using (public.is_staff());

-- Resolves the account the same way record_inbound_message does.
create or replace function public.resolve_account(p jsonb) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from public.whatsapp_accounts a
   where a.phone_number_id = p ->> 'phone_number_id'
     and a.enabled
     and (nullif(p ->> 'waba_id', '') is null or a.waba_id = p ->> 'waba_id')
$$;

-- A message the business sent from the WhatsApp Business app (or a linked
-- device). It never opens the 24-hour window. Unless Settings say otherwise,
-- the chat is handed to a human the first time this happens.
create or replace function public.record_business_echo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid := public.resolve_account(p);
  v_ts timestamptz := coalesce((p ->> 'provider_timestamp')::timestamptz, now());
  v_takeover boolean;
  v_contact uuid;
  v_conv uuid;
  v_status text;
  v_message uuid;
  v_took_over boolean := false;
begin
  if v_account is null then
    return jsonb_build_object('ignored', 'unknown_account');
  end if;
  select coalesce(s.settings -> 'coexistence' ->> 'onAppReply', 'pause') = 'pause'
    into v_takeover from public.app_settings s where s.id = 1;

  insert into public.contacts as c (wa_id)
  values (p ->> 'wa_id')
  on conflict (wa_id) do update set wa_id = excluded.wa_id
  returning c.id into v_contact;

  insert into public.conversations as cv (contact_id, account_id)
  values (v_contact, v_account)
  on conflict (contact_id, account_id) do update set account_id = excluded.account_id
  returning cv.id, cv.status into v_conv, v_status;

  insert into public.messages (
    conversation_id, contact_id, direction, wa_message_id, type, body, payload, status, source, provider_timestamp)
  values (
    v_conv, v_contact, 'outbound', p ->> 'wa_message_id', p ->> 'type', p ->> 'body', p -> 'payload', 'sent', 'business_app', v_ts)
  on conflict (wa_message_id) do nothing
  returning id into v_message;
  if v_message is null then
    return jsonb_build_object('conversation_id', v_conv, 'duplicate', true, 'took_over', false);
  end if;

  update public.conversations
     set human_last_reply_at = greatest(human_last_reply_at, v_ts),
         last_outbound_at = greatest(last_outbound_at, v_ts),
         status = case when coalesce(v_takeover, true) then 'handoff' else status end,
         handoff_reason = case when coalesce(v_takeover, true) and status <> 'handoff' then 'You replied from the WhatsApp Business app' else handoff_reason end,
         handoff_at = case when coalesce(v_takeover, true) and status <> 'handoff' then now() else handoff_at end,
         handoff_by = case when coalesce(v_takeover, true) and status <> 'handoff' then 'business_app' else handoff_by end
   where id = v_conv;
  v_took_over := coalesce(v_takeover, true) and v_status <> 'handoff';

  return jsonb_build_object('conversation_id', v_conv, 'contact_id', v_contact, 'duplicate', false, 'took_over', v_took_over);
end $$;

-- One chunk of imported chat history. Stored for reference only: never
-- processed by workflows and never touching the 24-hour window.
create or replace function public.record_history(p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid := public.resolve_account(p);
  v_contact uuid;
  v_conv uuid;
  v_count integer := 0;
  m jsonb;
begin
  if v_account is null then
    return 0;
  end if;
  insert into public.contacts as c (wa_id)
  values (p ->> 'wa_id')
  on conflict (wa_id) do update set wa_id = excluded.wa_id
  returning c.id into v_contact;
  insert into public.conversations as cv (contact_id, account_id)
  values (v_contact, v_account)
  on conflict (contact_id, account_id) do update set account_id = excluded.account_id
  returning cv.id into v_conv;

  for m in select * from jsonb_array_elements(coalesce(p -> 'messages', '[]'::jsonb)) loop
    insert into public.messages (
      conversation_id, contact_id, direction, wa_message_id, type, body, payload, status, processing_status,
      processing_note, source, provider_timestamp)
    values (
      v_conv, v_contact, m ->> 'direction', m ->> 'wa_message_id', m ->> 'type', m ->> 'body', m -> 'payload',
      case when m ->> 'direction' = 'inbound' then 'received' else 'sent' end,
      case when m ->> 'direction' = 'inbound' then 'ignored' end,
      case when m ->> 'direction' = 'inbound' then 'history' end,
      'history', (m ->> 'provider_timestamp')::timestamptz)
    on conflict (wa_message_id) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- Phone contacts from the WhatsApp Business app.
create or replace function public.sync_business_contacts(p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb;
  v_count integer := 0;
begin
  for c in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    continue when coalesce(c ->> 'wa_id', '') !~ '^[0-9]{6,20}$';
    if c ->> 'action' = 'remove' then
      delete from public.business_contacts where wa_id = c ->> 'wa_id';
      update public.contacts set saved_name = null where wa_id = c ->> 'wa_id';
    else
      insert into public.business_contacts (wa_id, full_name, first_name, updated_at)
      values (c ->> 'wa_id', nullif(c ->> 'full_name', ''), nullif(c ->> 'first_name', ''), now())
      on conflict (wa_id) do update
        set full_name = excluded.full_name, first_name = excluded.first_name, updated_at = now();
      update public.contacts set saved_name = nullif(c ->> 'full_name', '') where wa_id = c ->> 'wa_id';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- New customers get the name they have in the business's phone, if any.
create or replace function public.contacts_saved_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.saved_name is null then
    select full_name into new.saved_name from public.business_contacts where wa_id = new.wa_id;
  end if;
  return new;
end $$;
create trigger contacts_saved_name before insert on public.contacts
  for each row execute function public.contacts_saved_name();

-- The turn state also reports who took the chat over and when a person last replied.
-- Everything handling one inbound message reads before acting.
create or replace function public.conversation_turn_state(p_conversation_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', cv.id,
      'contact_id', cv.contact_id,
      'account_id', cv.account_id,
      'phone_number_id', a.phone_number_id,
      'status', cv.status,
      'last_inbound_at', cv.last_inbound_at,
      'is_test', cv.is_test,
      'handoff_by', cv.handoff_by,
      'handoff_at', cv.handoff_at,
      'human_last_reply_at', cv.human_last_reply_at),
    'contact', jsonb_build_object(
      'id', c.id,
      'wa_id', c.wa_id,
      'name', c.name,
      'profile_name', c.profile_name,
      'business_name', c.business_name,
      'email', c.email,
      'opted_out', c.opted_out,
      'cooldown_until', c.cooldown_until,
      'is_test', c.is_test,
      'tags', c.tags,
      'open_enquiry_at', (
        select max(l.created_at) from public.leads l
         where l.contact_id = c.id and l.status in ('new', 'qualified', 'contacted'))),
    'active', (
      select to_jsonb(e) || jsonb_build_object('flow_status', f.status)
        from public.flow_executions e
        join public.flows f on f.id = e.flow_id
       where e.conversation_id = cv.id
         and e.status in ('running', 'waiting_input', 'waiting_delay')
       limit 1),
    'last_completed_at', (
      select max(e.completed_at) from public.flow_executions e where e.conversation_id = cv.id),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'flow_id', f.id, 'flow_name', f.name, 'status', f.status, 'priority', f.priority,
               'version_id', v.id, 'version', v.version))
        from public.flows f
        join public.flow_versions v on v.id = f.published_version_id
       where f.status = 'active' or (f.status = 'testing' and cv.is_test)), '[]'::jsonb),
    'prior_executions', (select count(*) from public.flow_executions e where e.contact_id = c.id))
  from public.conversations cv
  join public.contacts c on c.id = cv.contact_id
  join public.whatsapp_accounts a on a.id = cv.account_id
  where cv.id = p_conversation_id
$$;


revoke execute on function public.resolve_account(jsonb) from public, anon, authenticated;
revoke execute on function public.record_business_echo(jsonb) from public, anon, authenticated;
revoke execute on function public.record_history(jsonb) from public, anon, authenticated;
revoke execute on function public.sync_business_contacts(jsonb) from public, anon, authenticated;
grant execute on function public.resolve_account(jsonb) to service_role;
grant execute on function public.record_business_echo(jsonb) to service_role;
grant execute on function public.record_history(jsonb) to service_role;
grant execute on function public.sync_business_contacts(jsonb) to service_role;
