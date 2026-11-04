-- REVIEW DRAFT ONLY. Not applied to staging or production by this change.
-- Run against a disposable database with the existing reports/payments schema first.
begin;
create table public.byl_orders (
  report_id uuid primary key references public.reports(id),
  payment_id uuid not null unique default gen_random_uuid(),
  project_id bigint not null check (project_id > 0),
  provider_invoice_id text check (provider_invoice_id ~ '^[1-9][0-9]*$'),
  checkout_url text,
  status text not null default 'creating' check (status in ('creating','open','paid','void')),
  amount_mnt integer not null default 6900 check (amount_mnt=6900),
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
grant select,insert,update on public.byl_orders,public.byl_events to service_role;

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
  if o.project_id<>p_project then raise exception 'Wrong project'; end if;
  return jsonb_build_object('created',inserted,'order',to_jsonb(o));
end $$;

create function public.bind_byl_invoice(p_report uuid,p_invoice text,p_project bigint,p_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.byl_orders;
begin
  perform 1 from public.reports where id=p_report for update;
  select * into strict o from public.byl_orders where report_id=p_report for update;
  if o.status<>'creating' or o.project_id<>p_project or p_invoice !~ '^[1-9][0-9]*$'
    or p_url !~ ('^https://byl[.]mn/h/invoice/'||p_invoice||'/[A-Za-z0-9]+$') then
    raise exception 'Invalid binding';
  end if;
  update public.byl_orders set provider_invoice_id=p_invoice,checkout_url=p_url,status='open'
    where report_id=p_report returning * into o;
  return to_jsonb(o);
end $$;

create function public.settle_byl_invoice(p_report uuid,p_invoice text,p_project bigint,p_status text,p_amount integer,p_event text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.byl_orders; final_status text;
begin
  perform 1 from public.reports where id=p_report for update;
  select * into strict o from public.byl_orders where report_id=p_report for update;
  if p_status is null or p_status not in ('paid','void') or p_amount is distinct from 6900
    or o.project_id is distinct from p_project or o.provider_invoice_id is distinct from p_invoice
    or o.provider_invoice_id is null then raise exception 'Invalid settlement'; end if;
  if p_event is not null then
    insert into public.byl_events(project_id,event_id,report_id) values(p_project,p_event,p_report)
      on conflict do nothing;
    if not found then
      if not exists(select 1 from public.byl_events where project_id=p_project and event_id=p_event and report_id=p_report)
        then raise exception 'Event replay across invoices'; end if;
      return jsonb_build_object('duplicate',true,'status',o.status);
    end if;
  end if;
  -- Void is terminal: an older in-flight verification cannot restore revoked access.
  final_status := case when o.status='void' then 'void' else p_status end;
  update public.byl_orders set status=final_status where report_id=p_report;
  insert into public.payments(id,report_id,provider,provider_invoice_id,amount_mnt,status,verified_at)
    values(o.payment_id,p_report,'byl',p_invoice,6900,
      case when final_status='paid' then 'paid' else 'refunded' end,now())
    on conflict(id) do update set status=excluded.status,verified_at=excluded.verified_at;
  update public.reports set status=case when final_status='paid' then 'paid' else 'unpaid' end,
    paid_at=case when final_status='paid' then coalesce(paid_at,now()) else null end where id=p_report;
  return jsonb_build_object('status',final_status);
end $$;

revoke all on function public.reserve_byl_invoice(uuid,text,bigint),
  public.bind_byl_invoice(uuid,text,bigint,text),
  public.settle_byl_invoice(uuid,text,bigint,text,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_byl_invoice(uuid,text,bigint),
  public.bind_byl_invoice(uuid,text,bigint,text),
  public.settle_byl_invoice(uuid,text,bigint,text,integer,text) to service_role;
commit;
