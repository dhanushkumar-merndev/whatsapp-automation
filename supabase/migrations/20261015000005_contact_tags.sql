-- =============================================================================
-- Customer tags (set by the "Tag customer" step, shown and filterable in the
-- dashboard). The turn state now includes them, so workflows can branch on tags.
-- =============================================================================

alter table public.contacts add column tags text[] not null default '{}';
create index contacts_tags_idx on public.contacts using gin (tags);

-- Adds and removes tags in one statement (no lost updates between steps).
create or replace function public.update_contact_tags(p_contact_id uuid, p_add text[], p_remove text[]) returns text[]
language sql security definer set search_path = '' as $$
  update public.contacts
     set tags = (
       select coalesce(array_agg(distinct t order by t), '{}')
         from unnest(array_cat(tags, p_add)) t
        where not (t = any (p_remove)))
   where id = p_contact_id
  returning tags
$$;
revoke execute on function public.update_contact_tags(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.update_contact_tags(uuid, text[], text[]) to service_role;

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

