-- Local representative fixture of the existing column contract, NOT a hosted schema dump.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon,authenticated,service_role;
create table public.reports (
  id uuid primary key, report jsonb not null, preview jsonb not null,
  status text not null check(status in ('unpaid','paid')),
  access_token_hash text not null, expires_at timestamptz not null, paid_at timestamptz
);
create table public.payments (
  id uuid primary key, report_id uuid not null references public.reports(id),
  provider text not null, provider_invoice_id text, amount_mnt integer not null,
  status text not null check(status in ('pending','paid','refunded')),
  verified_at timestamptz
);
alter table public.reports enable row level security;
alter table public.payments enable row level security;
revoke all on public.reports,public.payments from public,anon,authenticated;
grant select,insert,update,delete on public.reports,public.payments to service_role;
