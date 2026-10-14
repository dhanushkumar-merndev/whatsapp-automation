-- =============================================================================
-- Private media bucket + seed data (settings row, plan allowances, pricing)
-- =============================================================================

-- Private bucket: files are never publicly reachable. The server uploads them
-- to Meta's media endpoint when sending; admins preview via short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'video/mp4', 'video/3gpp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy media_objects_staff_read on storage.objects
  for select to authenticated using (bucket_id = 'media' and public.is_staff());
create policy media_objects_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_admin());
create policy media_objects_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());
create policy media_objects_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.is_admin());

-- Settings singleton (defaults are applied by the application schema) --------------
insert into public.app_settings (id, settings) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- Provider allowances. Values are starting points, editable in Usage & Limits.
-- source = 'seeded' means "entered from published plan pages", not live data.
insert into public.plan_limits
  (service, metric, period, limit_value, unit, unit_price, currency, category, country_code, plan_name, effective_from, source, notes)
values
  ('qstash', 'deliveries', 'day', 1000, 'messages', null, null, null, null, 'Free', '2026-10-14', 'seeded',
   'QStash Free: 1,000 messages per day. Retries count as additional deliveries. Resets daily (UTC).'),
  ('qstash', 'max_delay_seconds', 'total', 604800, 'seconds', null, null, null, null, 'Free', '2026-10-14', 'seeded',
   'Maximum delay per message on the Free plan (7 days). Verify in the Upstash console.'),
  ('redis', 'commands', 'month', 500000, 'commands', null, null, null, null, 'Free', '2026-10-14', 'seeded',
   'Upstash Redis Free: 500K commands per month.'),
  ('redis', 'storage_bytes', 'total', 268435456, 'bytes', null, null, null, null, 'Free', '2026-10-14', 'seeded',
   'Upstash Redis Free: 256 MB data size.'),
  ('supabase', 'database_bytes', 'total', 524288000, 'bytes', null, null, null, null, 'Free', '2026-10-14', 'seeded',
   'Supabase Free: 500 MB database.'),
  ('supabase', 'storage_bytes', 'total', 1073741824, 'bytes', null, null, null, null, 'Free', '2026-10-14', 'seeded',
   'Supabase Free: 1 GB file storage.'),
  ('supabase', 'upload_max_bytes', 'total', 52428800, 'bytes', null, null, null, null, 'Free', '2026-10-14', 'seeded',
   'Supabase Free: 50 MB maximum file upload size.'),
  ('meta_whatsapp', 'service_message', 'per_message', null, 'message', 0, 'USD', 'service', '*', 'Per-message pricing', '2025-07-01', 'seeded',
   'Free-form replies inside the 24-hour customer service window are not charged under Meta per-message pricing. MANUALLY CONFIGURED — confirm the rate card for your WhatsApp Business Account.'),
  ('vercel', 'commercial_use', 'total', 0, 'boolean', null, null, null, null, 'Hobby', '2026-10-14', 'seeded',
   'Vercel Hobby is for personal, non-commercial projects. Commercial production requires Pro (or Enterprise).'),
  ('vercel', 'cron_min_interval_seconds', 'total', 86400, 'seconds', null, null, null, null, 'Hobby', '2026-10-14', 'seeded',
   'Hobby cron jobs run at most once per day. Verify on vercel.com/pricing.'),
  ('vercel', 'commercial_use', 'total', 1, 'boolean', 20, 'USD', null, null, 'Pro', '2026-10-14', 'seeded',
   'Vercel Pro permits commercial use. Price is per member per month — verify on vercel.com/pricing.');
