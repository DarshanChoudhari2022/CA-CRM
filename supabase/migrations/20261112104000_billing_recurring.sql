-- A schedule snapshots a structured invoice for the same client.
create table public.billing_recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  client_id uuid not null references public.crm_clients(id),
  template_id uuid references public.crm_invoices(id) on delete set null,
  template_title text not null,
  template_notes text not null,
  template_amount numeric(12,2) not null,
  template_details jsonb not null,
  interval_months integer not null check (interval_months in (1, 3, 12)),
  anchor_day integer not null check (anchor_day between 1 and 31),
  next_due_on date not null,
  payment_terms_days integer check (payment_terms_days between 0 and 999),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, request_id)
);

create index billing_recurring_due on public.billing_recurring_schedules(organization_id, next_due_on, id)
  where active;

-- Retain the period even if its invoice is subsequently deleted.
create table public.billing_recurring_periods (
  schedule_id uuid not null references public.billing_recurring_schedules(id),
  due_on date not null,
  invoice_id uuid unique references public.crm_invoices(id) on delete set null,
  primary key (schedule_id, due_on)
);

alter table public.billing_recurring_schedules enable row level security;
alter table public.billing_recurring_periods enable row level security;
revoke all on public.billing_recurring_schedules, public.billing_recurring_periods from public, anon, authenticated;
grant select on public.billing_recurring_schedules to authenticated;

create policy billing_recurring_admin_read on public.billing_recurring_schedules
for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and (select public.has_portal_role(array['admin','partner']::public.portal_role[]))
);

create function public.billing_create_recurring_schedule(
  p_request uuid, p_client uuid, p_template uuid, p_interval_months integer, p_first_due date, p_payment_terms_days integer
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  org uuid := public.current_organization_id();
  source public.crm_invoices;
  schedule_id uuid;
begin
  perform public.assert_admin();
  if org is null then raise exception 'Active organization required'; end if;
  if p_request is null or p_interval_months is null or p_interval_months not in (1, 3, 12)
    or p_first_due is null or p_first_due not between date '2000-01-01' and date '2100-12-31'
    or p_payment_terms_days not between 0 and 999 then
    raise exception 'Invalid recurring schedule';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(org::text || ':billing-recurring-create:' || p_request::text, 0));
  select id into schedule_id from public.billing_recurring_schedules where organization_id = org and request_id = p_request;
  if found then return schedule_id; end if;

  select i.* into source
  from public.crm_invoices i
  join public.crm_clients c on c.id = i.client_id and c.organization_id = i.organization_id
  where i.id = p_template and i.organization_id = org and c.id = p_client
    and i.status in ('draft', 'issued') and i.invoice_details->>'documentType' = 'invoice'
  for share of i, c;
  if not found then raise exception 'Choose a structured invoice for this client'; end if;

  insert into public.billing_recurring_schedules (
    organization_id, request_id, client_id, template_id, template_title, template_notes, template_amount, template_details,
    interval_months, anchor_day, next_due_on, payment_terms_days
  ) values (
    org, p_request, p_client, source.id, source.title, source.notes, source.amount, source.invoice_details,
    p_interval_months, extract(day from p_first_due)::integer, p_first_due, p_payment_terms_days
  ) returning id into schedule_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, request_id)
    values (org, auth.uid(), 'billing_recurring_created', 'billing_recurring_schedules', schedule_id::text, p_request);
  return schedule_id;
end;
$$;

create function public.billing_set_recurring_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  org uuid := public.current_organization_id();
begin
  perform public.assert_admin();
  if org is null or p_active is null then raise exception 'Invalid recurring schedule'; end if;
  update public.billing_recurring_schedules set active = p_active
    where id = p_id and organization_id = org and active is distinct from p_active;
  if found then
    insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, request_id)
      values (org, auth.uid(), case when p_active then 'billing_recurring_resumed' else 'billing_recurring_paused' end,
        'billing_recurring_schedules', p_id::text, gen_random_uuid());
  elsif not exists (select 1 from public.billing_recurring_schedules where id = p_id and organization_id = org) then
    raise exception 'Schedule unavailable';
  end if;
end;
$$;

create function public.billing_run_due_recurring()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  org uuid := public.current_organization_id();
  local_today date;
  schedule public.billing_recurring_schedules;
  period date;
  target_month date;
  last_day date;
  draft_id uuid;
  generated integer := 0;
  failed integer := 0;
  attempts integer := 0;
begin
  perform public.assert_admin();
  if org is null then raise exception 'Active organization required'; end if;
  select (now() at time zone timezone)::date into local_today from public.organizations where id = org;

  -- Serialize manual runs in this organization. Schedule row locks also serialize pauses.
  perform pg_advisory_xact_lock(hashtextextended(org::text || ':billing-recurring', 0));
  for schedule in
    select * from public.billing_recurring_schedules
    where organization_id = org and active and next_due_on <= local_today
    order by next_due_on, id
    limit 100
    for update
  loop
    period := schedule.next_due_on;
    while period <= local_today and attempts < 100 loop
      attempts := attempts + 1;
      begin
        insert into public.billing_recurring_periods (schedule_id, due_on)
          values (schedule.id, period) on conflict (schedule_id, due_on) do nothing;
        if found then
          draft_id := public.crm_save('invoices', null, jsonb_build_object(
            'status', 'draft', 'title', schedule.template_title, 'notes', schedule.template_notes,
            'client_id', schedule.client_id, 'amount', schedule.template_amount,
            'due_date', period + schedule.payment_terms_days,
            'invoice_details', schedule.template_details || jsonb_build_object(
              'invoiceDate', to_char(period, 'YYYY-MM-DD'), 'reference', ''
            )
          ));
          update public.billing_recurring_periods set invoice_id = draft_id
            where schedule_id = schedule.id and due_on = period;
          insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata)
            values (org, auth.uid(), 'billing_recurring_draft_created', 'billing_recurring_schedules', schedule.id::text,
              gen_random_uuid(), jsonb_build_object('due_on', period, 'invoice_id', draft_id));
        else
          draft_id := null;
        end if;

        -- Clamp short months and recover the original day the following month.
        target_month := (date_trunc('month', period::timestamp) + make_interval(months => schedule.interval_months))::date;
        last_day := (target_month + interval '1 month' - interval '1 day')::date;
        period := target_month + least(schedule.anchor_day - 1, last_day - target_month);
        update public.billing_recurring_schedules set next_due_on = period where id = schedule.id;
        if draft_id is not null then generated := generated + 1; end if;
      exception
        when raise_exception or integrity_constraint_violation or data_exception then
          -- Roll back the claim and draft together. Leave this period due for a retry.
          failed := failed + 1;
          exit;
      end;
    end loop;
    exit when attempts >= 100;
  end loop;
  return jsonb_build_object(
    'generated', generated,
    'failed', failed,
    'more', attempts >= 100 and exists (
      select 1 from public.billing_recurring_schedules
      where organization_id = org and active and next_due_on <= local_today
    )
  );
end;
$$;

revoke all on function public.billing_create_recurring_schedule(uuid, uuid, uuid, integer, date, integer),
  public.billing_set_recurring_active(uuid, boolean), public.billing_run_due_recurring()
  from public, anon, authenticated;
grant execute on function public.billing_create_recurring_schedule(uuid, uuid, uuid, integer, date, integer),
  public.billing_set_recurring_active(uuid, boolean), public.billing_run_due_recurring()
  to authenticated;
