-- Chats that messaged the Telegram bot. Once action buttons are on, Telegram
-- sends updates to our webhook (getUpdates stops working), so "Find chat IDs"
-- reads them from here instead.
create table public.telegram_chats (
  id text primary key check (id ~ '^-?[0-9]{1,20}$'),
  title text,
  type text,
  last_seen_at timestamptz not null default now()
);
alter table public.telegram_chats enable row level security;
create policy telegram_chats_require_mfa on public.telegram_chats as restrictive for all to authenticated
  using (public.current_aal() = 'aal2') with check (public.current_aal() = 'aal2');
create policy telegram_chats_admin_read on public.telegram_chats for select to authenticated using (public.is_admin());
