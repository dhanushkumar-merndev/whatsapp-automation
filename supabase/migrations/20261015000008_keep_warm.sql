-- =============================================================================
-- Keep the WhatsApp webhook function warm
--   A function that has been idle for a few minutes starts cold, which added
--   4-5 s to the first reply. pg_cron + pg_net (both free on Supabase) request
--   /api/webhooks/whatsapp?warm=1 every minute. configure_keep_warm(url) is
--   called by the daily sweep with the site URL, so nothing has to be set by hand.
--   Where the extensions don't exist (e.g. local PGlite tests) it is a no-op.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

create schema if not exists sgh_private;
revoke all on schema sgh_private from public;

create table sgh_private.keep_warm (
  id smallint primary key default 1 check (id = 1),
  url text not null check (url ~ '^https://[^/[:space:]]+$'),
  updated_at timestamptz not null default now()
);
revoke all on sgh_private.keep_warm from public, anon, authenticated;

-- Saves the site URL and (re)creates the cron jobs; safe to call repeatedly.
-- Returns 'on', 'unavailable' (no pg_cron / pg_net) or 'skipped' (not an https site, e.g. localhost).
create or replace function public.configure_keep_warm(p_url text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := substring(rtrim(coalesce(p_url, ''), '/') from '^https://[^/[:space:]]+$');
begin
  if v_url is null then
    return 'skipped';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    return 'unavailable';
  end if;
  insert into sgh_private.keep_warm (id, url) values (1, v_url)
  on conflict (id) do update set url = excluded.url, updated_at = now()
   where sgh_private.keep_warm.url is distinct from excluded.url;
  -- Scheduling under an existing name updates that job.
  perform cron.schedule('sgh-keep-warm', '* * * * *',
    $job$select net.http_get(url := k.url || '/api/webhooks/whatsapp?warm=1', timeout_milliseconds := 10000)
           from sgh_private.keep_warm k where k.id = 1$job$);
  perform cron.schedule('sgh-cron-log-cleanup', '17 4 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '1 day'$job$);
  return 'on';
end $$;

revoke execute on function public.configure_keep_warm(text) from public, anon, authenticated;
grant execute on function public.configure_keep_warm(text) to service_role;
