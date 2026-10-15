-- =============================================================================
-- One live workflow at a time (plus at most one workflow for test numbers).
-- Making a workflow live pauses the previous one in the same transaction;
-- conversations already running on it may finish (see process-conversation).
-- =============================================================================

-- Keep the most recently published live / test workflow; pause any others.
with ranked as (
  select f.id, f.status,
         row_number() over (partition by f.status order by v.created_at desc nulls last, f.updated_at desc) as rn
    from public.flows f
    left join public.flow_versions v on v.id = f.published_version_id
   where f.status in ('active', 'testing')
)
update public.flows f set status = 'paused'
  from ranked r
 where r.id = f.id and r.rn > 1;

create unique index flows_one_live on public.flows ((status)) where status = 'active';
create unique index flows_one_testing on public.flows ((status)) where status = 'testing';

-- Changes a workflow's status; "active" / "testing" first pause whichever
-- workflow held that role. Callable by admins (and the service role).
create or replace function public.set_flow_status(p_flow_id uuid, p_status text, p_user uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_replaced uuid;
begin
  if not (public.is_admin() or coalesce((select auth.jwt()) ->> 'role', '') = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'testing', 'active', 'paused', 'archived') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  if p_status in ('active', 'testing') then
    if not exists (select 1 from public.flows where id = p_flow_id and published_version_id is not null) then
      raise exception 'Publish the workflow before making it live.' using errcode = 'P0001';
    end if;
    update public.flows
       set status = 'paused', updated_by = coalesce(p_user, updated_by)
     where status = p_status and id <> p_flow_id
    returning id into v_replaced;
  end if;
  update public.flows
     set status = p_status, updated_by = coalesce(p_user, updated_by)
   where id = p_flow_id;
  if not found then
    raise exception 'Workflow not found' using errcode = 'P0002';
  end if;
  return v_replaced;
end $$;

revoke execute on function public.set_flow_status(uuid, text, uuid) from public, anon;
grant execute on function public.set_flow_status(uuid, text, uuid) to authenticated, service_role;
