-- STAGING CANDIDATE ONLY. Approval required before applying this revision anywhere.
-- Reviewed against glowup-ai-staging metadata on 2026-11-04; no hosted changes applied.
begin;
create table public.byl_orders (
  report_id uuid primary key references public.reports(id),
  payment_id uuid not null unique default gen_random_uuid(),
  project_id bigint not null check (project_id > 0),
  provider_invoice_id text check (provider_invoice_id ~ '^[1-9][0-9]*$'),
  checkout_url text,
  status text not null default 'creating' check (status in ('creating','open','paid','void')),
  amount_mnt integer not null default 6900 check (amount_mnt=6900),
  next_verify_at timestamptz not null default '-infinity',
  unique(project_id,provider_invoice_id)
);
create table public.byl_events (
  project_id bigint not null,
  event_id text not null,
  report_id uuid not null references public.byl_orders(report_id),
  processed_at timestamptz not null default now(),
  primary key(project_id,event_id)
);
alter table public.byl_orders enable row level security;
alter table public.byl_events enable row level security;
revoke all on public.byl_orders,public.byl_events from public,anon,authenticated;
grant select,insert,update,delete on public.byl_orders,public.byl_events to service_role;

create function public.reserve_byl_invoice(p_report uuid,p_hash text,p_project bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.byl_orders; inserted boolean := false;
begin
  perform 1 from public.reports where id=p_report and access_token_hash=p_hash
    and status='unpaid' and expires_at>now() for update;
  if not found then raise exception 'Report unavailable'; end if;
  select * into o from public.byl_orders where report_id=p_report;
  if not found then
    insert into public.byl_orders(report_id,project_id) values(p_report,p_project) returning * into o;
    inserted := true;
  end if;
  if o.project_id is distinct from p_project then raise exception 'Wrong project'; end if;
  return jsonb_build_object('created',inserted,'order',to_jsonb(o));
end $$;

create function public.bind_byl_invoice(p_report uuid,p_invoice text,p_project bigint,p_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.byl_orders;
begin
  perform 1 from public.reports where id=p_report for update;
  select * into strict o from public.byl_orders where report_id=p_report for update;
  if o.status<>'creating' or o.project_id is distinct from p_project or p_invoice is null
    or p_invoice !~ '^[1-9][0-9]*$' or p_url is null
    or p_url !~ ('^https://byl[.]mn/h/invoice/'||p_invoice||'/[A-Za-z0-9]+$') then
    raise exception 'Invalid binding';
  end if;
  update public.byl_orders set provider_invoice_id=p_invoice,checkout_url=p_url,status='open'
    where report_id=p_report returning * into o;
  return to_jsonb(o);
end $$;

create function public.settle_byl_invoice(p_report uuid,p_invoice text,p_project bigint,p_status text,p_amount integer,p_event text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.byl_orders; final_status text; ledger_status text;
begin
  perform 1 from public.reports where id=p_report for update;
  select * into strict o from public.byl_orders where report_id=p_report for update;
  if p_status is null or p_status not in ('paid','void') or p_amount is distinct from 6900
    or o.project_id is distinct from p_project or o.provider_invoice_id is distinct from p_invoice
    or o.provider_invoice_id is null then raise exception 'Invalid settlement'; end if;
  select status into ledger_status from public.payments where id=o.payment_id for update;
  -- A recorded refund is terminal even if an older provider read still says paid.
  final_status := case when o.status='void' or ledger_status='refunded' then 'void' else p_status end;
  if p_event is not null then
    insert into public.byl_events(project_id,event_id,report_id) values(p_project,p_event,p_report)
      on conflict do nothing;
    if not found then
      if not exists(select 1 from public.byl_events where project_id=p_project and event_id=p_event and report_id=p_report)
        then raise exception 'Event replay across invoices'; end if;
      return jsonb_build_object('duplicate',true,'status',case when ledger_status='refunded' then 'void' else o.status end);
    end if;
  end if;
  -- Void is terminal: an older in-flight verification cannot restore revoked access.
  update public.byl_orders set status=final_status where report_id=p_report;
  insert into public.payments(id,report_id,provider,provider_invoice_id,amount_mnt,status,verified_at)
    -- Staging enforces global UNIQUE(provider_invoice_id). Preserve it and avoid
    -- raw QPay/cross-project Byl collisions without changing existing rows.
    values(o.payment_id,p_report,'byl','byl:'||p_project::text||':'||p_invoice,6900,
      case when final_status='paid' then 'paid' else 'refunded' end,now())
    on conflict(id) do update set status=excluded.status,verified_at=excluded.verified_at
    where payments.report_id=excluded.report_id and payments.provider=excluded.provider
      and payments.provider_invoice_id=excluded.provider_invoice_id and payments.amount_mnt=excluded.amount_mnt;
  if not found then raise exception 'Conflicting payment ledger'; end if;
  update public.reports set status=case when status='expired' then 'expired' when final_status='paid' then 'paid' else 'unpaid' end,
    paid_at=case when final_status='paid' then coalesce(paid_at,now()) else null end where id=p_report;
  return jsonb_build_object('status',final_status);
end $$;

-- Every authorization path checks the current Byl order AND its exact ledger row.
-- Legacy QPay rows and unrelated paid Byl rows cannot substitute for this binding.
create function public.has_verified_byl_payment(p_report uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.byl_orders o join public.payments p
    on p.id=o.payment_id and p.report_id=o.report_id
      and p.provider_invoice_id='byl:'||o.project_id::text||':'||o.provider_invoice_id
    where o.report_id=p_report and o.status='paid' and o.amount_mnt=6900
      and o.provider_invoice_id is not null and p.provider='byl' and p.status='paid'
      and p.amount_mnt=6900 and p.verified_at is not null);
$$;
create function public.read_byl_report(p_report uuid,p_hash text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select r.report from public.reports r where r.id=p_report and r.access_token_hash=p_hash
    and r.status='paid' and r.expires_at>now() and public.has_verified_byl_payment(r.id);
$$;
create function public.claim_byl_verification(p_report uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.byl_orders set next_verify_at=clock_timestamp()+interval '10 seconds'
    where report_id=p_report and provider_invoice_id is not null and next_verify_at<=clock_timestamp();
  return found;
end $$;

revoke all on function public.reserve_byl_invoice(uuid,text,bigint),
  public.bind_byl_invoice(uuid,text,bigint,text),
  public.settle_byl_invoice(uuid,text,bigint,text,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_byl_invoice(uuid,text,bigint),
  public.bind_byl_invoice(uuid,text,bigint,text),
  public.settle_byl_invoice(uuid,text,bigint,text,integer,text) to service_role;
revoke all on function public.has_verified_byl_payment(uuid),public.read_byl_report(uuid,text),
  public.claim_byl_verification(uuid) from public,anon,authenticated;
grant execute on function public.has_verified_byl_payment(uuid),public.read_byl_report(uuid,text),
  public.claim_byl_verification(uuid) to service_role;
commit;
