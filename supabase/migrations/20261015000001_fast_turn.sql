-- =============================================================================
-- Faster replies: fewer round trips on the inbound path
--   * record_inbound_message resolves the WhatsApp account itself (by phone
--     number id + WABA id) and marks test numbers from app_settings, so the
--     webhook no longer waits for an account lookup or the settings row. It
--     also returns what the webhook needs to show "typing…" straight away.
--   * begin_turn takes the conversation lock and returns the pending messages
--     plus everything the first reply needs (conversation_turn_state) in one call.
-- =============================================================================

create or replace function public.record_inbound_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ts timestamptz := coalesce((p ->> 'provider_timestamp')::timestamptz, now());
  v_account_id uuid := nullif(p ->> 'account_id', '')::uuid;
  v_is_test boolean;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_conversation_status text;
  v_opted_out boolean;
  v_cooldown_until timestamptz;
  v_message_id uuid;
  v_new_contact boolean;
begin
  if v_account_id is null then
    select a.id into v_account_id
      from public.whatsapp_accounts a
     where a.phone_number_id = p ->> 'phone_number_id'
       and a.enabled
       and (nullif(p ->> 'waba_id', '') is null or a.waba_id = p ->> 'waba_id');
    if v_account_id is null then
      return jsonb_build_object('ignored', 'unknown_account');
    end if;
  end if;

  v_is_test := coalesce((p ->> 'is_test')::boolean, false)
    or exists (
      select 1
        from public.app_settings s,
             jsonb_array_elements_text(coalesce(s.settings -> 'testPhoneNumbers', '[]'::jsonb)) t(n)
       where s.id = 1 and t.n = p ->> 'wa_id');

  insert into public.contacts as c (wa_id, profile_name, is_test, last_seen_at)
  values (p ->> 'wa_id', nullif(p ->> 'profile_name', ''), v_is_test, v_ts)
  on conflict (wa_id) do update
    set profile_name = coalesce(excluded.profile_name, c.profile_name),
        last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at),
        is_test = c.is_test or excluded.is_test
  returning c.id, (c.xmax = 0), c.opted_out, c.cooldown_until
    into v_contact_id, v_new_contact, v_opted_out, v_cooldown_until;

  insert into public.conversations as cv (contact_id, account_id, is_test, last_inbound_at)
  values (v_contact_id, v_account_id, v_is_test, v_ts)
  on conflict (contact_id, account_id) do update
    set last_inbound_at = greatest(cv.last_inbound_at, excluded.last_inbound_at),
        is_test = cv.is_test or excluded.is_test
  returning cv.id, cv.status into v_conversation_id, v_conversation_status;

  insert into public.messages (
    conversation_id, contact_id, direction, wa_message_id, type, body, payload,
    status, processing_status, is_test, provider_timestamp)
  values (
    v_conversation_id, v_contact_id, 'inbound', p ->> 'wa_message_id', p ->> 'type',
    p ->> 'body', p -> 'payload', 'received', 'pending', v_is_test, v_ts)
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  return jsonb_build_object(
    'account_id', v_account_id,
    'contact_id', v_contact_id,
    'conversation_id', v_conversation_id,
    'conversation_status', v_conversation_status,
    'opted_out', v_opted_out,
    'cooldown_until', v_cooldown_until,
    'is_test', v_is_test,
    'message_id', v_message_id,
    'duplicate', v_message_id is null,
    'new_contact', v_new_contact);
end $$;

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
      'is_test', cv.is_test),
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

-- Lock + pending messages + turn state in one round trip.
create or replace function public.begin_turn(
  p_conversation_id uuid, p_token uuid, p_ttl_seconds integer, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.acquire_conversation_lock(p_conversation_id, p_token, p_ttl_seconds) then
    return jsonb_build_object('locked', false);
  end if;
  return jsonb_build_object(
    'locked', true,
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'wa_message_id', m.wa_message_id, 'type', m.type, 'body', m.body,
               'payload', m.payload, 'provider_timestamp', m.provider_timestamp)
               order by m.provider_timestamp, m.created_at)
        from (
          select * from public.messages
           where conversation_id = p_conversation_id
             and direction = 'inbound'
             and processing_status = 'pending'
           order by provider_timestamp, created_at
           limit p_limit) m), '[]'::jsonb),
    'state', public.conversation_turn_state(p_conversation_id));
end $$;

revoke execute on function public.conversation_turn_state(uuid) from public, anon, authenticated;
revoke execute on function public.begin_turn(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.conversation_turn_state(uuid) to service_role;
grant execute on function public.begin_turn(uuid, uuid, integer, integer) to service_role;
