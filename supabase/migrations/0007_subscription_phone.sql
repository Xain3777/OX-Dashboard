-- Add phone_number to subscriptions for Syrian format validation (09XXXXXXXX).
alter table public.subscriptions
  add column if not exists phone_number text;
