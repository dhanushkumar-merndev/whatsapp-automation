-- =============================================================================
-- MFA on/off switch
--   app_settings.settings -> 'security' -> 'mfaRequired'  (missing = required)
-- When MFA is switched off, a signed-in (aal1) session counts as aal2 in every
-- policy. Anonymous callers still get nothing. Setting it back to true (or
-- removing the key) restores the original rules with no other change.
-- =============================================================================

create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (s.settings -> 'security' ->> 'mfaRequired')::boolean from public.app_settings s where s.id = 1),
    true)
$$;

create or replace function public.current_aal() returns text
language sql stable set search_path = '' as $$
  select case
    when coalesce((select auth.jwt()) ->> 'aal', '') = 'aal1' and not public.mfa_required() then 'aal2'
    else coalesce((select auth.jwt()) ->> 'aal', '')
  end
$$;

create or replace function public.has_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_aal() = 'aal2'
     and exists (
       select 1 from public.profiles p
       where p.id = (select auth.uid())
         and p.status = 'active'
         and p.role = any (p_roles)
     )
$$;
