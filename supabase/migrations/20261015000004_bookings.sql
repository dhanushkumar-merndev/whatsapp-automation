-- =============================================================================
-- Bookings (appointments) made from the "Booking" workflow step.
-- A slot never holds more bookings than its capacity: book_slot serialises
-- bookings per calendar + start time with an advisory lock.
-- =============================================================================

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  calendar text not null default 'main' check (char_length(calendar) between 1 and 60),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  flow_id uuid references public.flows (id) on delete set null,
  flow_execution_id uuid references public.flow_executions (id) on delete set null,
  node_id text,
  lead_id uuid references public.leads (id) on delete set null,
  service text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Kolkata',
  status text not null default 'booked' check (status in ('booked', 'confirmed', 'cancelled', 'completed', 'no_show')),
  notes text,
  -- Reminder rendered at booking time: { text, template, language, params }.
  reminder jsonb,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index bookings_slot_idx on public.bookings (calendar, starts_at) where status in ('booked', 'confirmed');
create index bookings_starts_idx on public.bookings (starts_at);
create index bookings_contact_idx on public.bookings (contact_id);
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

alter table public.scheduled_jobs add column booking_id uuid references public.bookings (id) on delete cascade;

alter table public.bookings enable row level security;
create policy bookings_require_mfa on public.bookings as restrictive for all to authenticated
  using (public.current_aal() = 'aal2') with check (public.current_aal() = 'aal2');
create policy bookings_staff_read on public.bookings for select to authenticated using (public.is_staff());
create policy bookings_staff_update on public.bookings
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- Books one slot if it still has room. Repeating the same execution + step
-- returns the booking it already made instead of booking twice.
create or replace function public.book_slot(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_calendar text := coalesce(nullif(p ->> 'calendar', ''), 'main');
  v_starts timestamptz := (p ->> 'starts_at')::timestamptz;
  v_capacity integer := greatest(coalesce((p ->> 'capacity')::integer, 1), 1);
  v_taken integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('booking:' || v_calendar || ':' || v_starts::text));

  select id into v_id from public.bookings
   where flow_execution_id = nullif(p ->> 'flow_execution_id', '')::uuid
     and node_id = p ->> 'node_id'
     and status in ('booked', 'confirmed')
   limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
  end if;

  select count(*) into v_taken from public.bookings
   where calendar = v_calendar and starts_at = v_starts and status in ('booked', 'confirmed');
  if v_taken >= v_capacity then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  insert into public.bookings (
    calendar, contact_id, conversation_id, flow_id, flow_execution_id, node_id, lead_id,
    service, starts_at, ends_at, timezone, reminder, is_test)
  values (
    v_calendar, (p ->> 'contact_id')::uuid, (p ->> 'conversation_id')::uuid,
    nullif(p ->> 'flow_id', '')::uuid, nullif(p ->> 'flow_execution_id', '')::uuid, p ->> 'node_id',
    nullif(p ->> 'lead_id', '')::uuid, nullif(p ->> 'service', ''), v_starts, (p ->> 'ends_at')::timestamptz,
    coalesce(nullif(p ->> 'timezone', ''), 'Asia/Kolkata'), p -> 'reminder', coalesce((p ->> 'is_test')::boolean, false))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'existing', false);
end $$;

revoke execute on function public.book_slot(jsonb) from public, anon, authenticated;
grant execute on function public.book_slot(jsonb) to service_role;
