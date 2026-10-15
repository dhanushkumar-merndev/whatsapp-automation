-- New scheduled job kinds: "No reply" timers on questions and booking reminders.
alter table public.scheduled_jobs drop constraint scheduled_jobs_kind_check;
alter table public.scheduled_jobs
  add constraint scheduled_jobs_kind_check
  check (kind in ('flow_resume', 'crm_retry', 'input_timeout', 'booking_reminder'));
