-- =============================================================================
-- restore_rows: put rows from an exported backup file back, ADD-ONLY.
--   * a row that already exists (same primary key or any unique value) is
--     skipped — nothing is overwritten and nothing is ever deleted;
--   * a row whose parent row is not there yet is returned in "retry" so the
--     caller can send it again after the other tables;
--   * identity counters are moved past the restored ids.
-- Service role only (called from the owner-only restore action).
-- =============================================================================

create or replace function public.restore_rows(p_table text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed text[] := array[
    'app_settings', 'plan_limits', 'whatsapp_accounts', 'contacts', 'business_contacts', 'conversations',
    'media_assets', 'flows', 'flow_versions', 'flow_executions', 'node_executions', 'messages', 'leads',
    'bookings', 'crm_integrations', 'usage_records', 'notifications', 'telegram_chats', 'audit_logs'];
  r jsonb;
  n integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_retry jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_seq text;
  v_max bigint;
begin
  if not (p_table = any (v_allowed)) then
    raise exception 'table % cannot be restored', p_table;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      execute format(
        'insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, $1) on conflict do nothing',
        p_table, p_table) using r;
      get diagnostics n = row_count;
      if n = 1 then v_inserted := v_inserted + 1; else v_skipped := v_skipped + 1; end if;
    exception
      when foreign_key_violation then
        v_retry := v_retry || jsonb_build_array(r);
      when others then
        if jsonb_array_length(v_errors) < 5 then v_errors := v_errors || to_jsonb(sqlerrm); end if;
    end;
  end loop;

  v_seq := pg_get_serial_sequence(format('public.%I', p_table), 'id');
  if v_seq is not null then
    execute format('select max(id) from public.%I', p_table) into v_max;
    if v_max is not null then perform setval(v_seq, v_max); end if;
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'retry', v_retry, 'errors', v_errors);
end $$;

revoke execute on function public.restore_rows(text, jsonb) from public, anon, authenticated;
grant execute on function public.restore_rows(text, jsonb) to service_role;
