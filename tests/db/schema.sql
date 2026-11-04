-- Synthetic regression fixture, NOT an export of any hosted schema.
-- Simulates stricter invoice uniqueness, explicit expiry and documented automatic
-- grants. Prepared only: replay of the revised candidate requires approval.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon,authenticated,service_role;
-- Simulate the public documented default-grant risk; migration revokes must win.
alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon,authenticated,service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon,authenticated,service_role;
create table public.reports (
  id uuid primary key, report jsonb not null, preview jsonb not null,
  status text not null check(status in ('unpaid','paid','expired')),
  access_token_hash text not null, expires_at timestamptz not null, paid_at timestamptz
);
create table public.payments (
  id uuid primary key, report_id uuid not null references public.reports(id) on delete cascade,
  provider text not null, provider_invoice_id text unique, amount_mnt integer not null,
  status text not null check(status in ('pending','paid','refunded')), verified_at timestamptz
);
create table public.events (
  id bigint generated always as identity primary key, report_id uuid references public.reports(id) on delete set null,
  event_type text not null
);
alter table public.reports enable row level security;
alter table public.payments enable row level security;
alter table public.events enable row level security;
revoke all on public.reports,public.payments,public.events from public,anon,authenticated;
grant all on public.reports,public.payments,public.events to service_role;
