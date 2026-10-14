-- =============================================================================
-- Row Level Security
--   * anon: no access to anything.
--   * authenticated: only with an AAL2 (MFA-verified) session AND an active
--     profile, enforced by a RESTRICTIVE policy on every table plus role checks.
--   * service_role (server-side webhooks/workers) bypasses RLS by design.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'app_settings', 'whatsapp_accounts', 'contacts', 'conversations', 'media_assets',
    'flows', 'flow_versions', 'flow_executions', 'node_executions', 'messages', 'leads',
    'crm_integrations', 'crm_deliveries', 'scheduled_jobs', 'usage_records', 'plan_limits',
    'rate_limit_events', 'audit_logs', 'notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (public.current_aal() = ''aal2'') with check (public.current_aal() = ''aal2'')',
      t || '_require_mfa', t);
  end loop;
end $$;

-- Read access for all active staff (owner/admin/staff) --------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'app_settings', 'whatsapp_accounts', 'contacts', 'conversations', 'media_assets',
    'flows', 'flow_versions', 'flow_executions', 'node_executions', 'messages', 'leads',
    'crm_deliveries', 'scheduled_jobs', 'usage_records', 'plan_limits', 'notifications'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())',
      t || '_staff_read', t);
  end loop;
end $$;

-- Admin-only reads ----------------------------------------------------------------
create policy crm_integrations_admin_read on public.crm_integrations
  for select to authenticated using (public.is_admin());
create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated using (public.is_admin());
create policy rate_limit_events_admin_read on public.rate_limit_events
  for select to authenticated using (public.is_admin());

-- Secrets never leave the server: authenticated users cannot select the
-- encrypted credential columns even as admins.
revoke select on public.crm_integrations from authenticated;
grant select (id, name, url, enabled, auth_type, field_mapping, last_success_at, last_failure_at,
              last_error, created_by, created_at, updated_at)
  on public.crm_integrations to authenticated;

-- Staff writes (working leads and conversations) -----------------------------------
create policy leads_staff_update on public.leads
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy conversations_staff_update on public.conversations
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy contacts_staff_update on public.contacts
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy notifications_staff_update on public.notifications
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy audit_logs_staff_insert on public.audit_logs
  for insert to authenticated with check (public.is_staff() and actor_id = (select auth.uid()));

-- Admin writes -----------------------------------------------------------------------
create policy app_settings_admin_update on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy whatsapp_accounts_admin_write on public.whatsapp_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy plan_limits_admin_write on public.plan_limits
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy crm_integrations_admin_write on public.crm_integrations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy flows_admin_insert on public.flows
  for insert to authenticated with check (public.is_admin());
create policy flows_admin_update on public.flows
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Published versions are append-only: insert, never update or delete.
create policy flow_versions_admin_insert on public.flow_versions
  for insert to authenticated with check (public.is_admin());

create policy media_assets_admin_insert on public.media_assets
  for insert to authenticated with check (public.is_admin());
create policy media_assets_admin_update on public.media_assets
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy crm_deliveries_admin_update on public.crm_deliveries
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy leads_admin_delete on public.leads
  for delete to authenticated using (public.is_admin());
create policy contacts_admin_delete on public.contacts
  for delete to authenticated using (public.is_admin());
