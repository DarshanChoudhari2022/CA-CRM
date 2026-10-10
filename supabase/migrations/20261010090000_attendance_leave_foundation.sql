-- PSB Firm Portal: attendance and leave foundation
-- Apply through Supabase migrations. All browser writes go through validated functions.

create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.portal_role as enum ('employee', 'manager', 'admin', 'partner');
create type public.attendance_result as enum ('full_day', 'half_day', 'short_day', 'absent', 'excused', 'not_applicable');
create type public.request_state as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.leave_portion as enum ('full_day', 'first_half', 'second_half');
create type public.month_state as enum ('open', 'closed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  active boolean not null default true,
  unique (organization_id, name)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  full_name text not null,
  role public.portal_role not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.attendance_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  effective_from date not null,
  shift_start time not null default '10:30',
  shift_end time not null default '19:30',
  grace_minutes integer not null default 15 check (grace_minutes >= 0),
  full_day_minutes integer not null default 480 check (full_day_minutes > 0),
  half_day_minutes integer not null default 240 check (half_day_minutes > 0),
  correction_window_days integer not null default 7 check (correction_window_days >= 0),
  working_days smallint[] not null default '{1,2,3,4,5,6}',
  created_at timestamptz not null default now(),
  check (half_day_minutes <= full_day_minutes),
  unique (organization_id, name, effective_from)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  profile_user_id uuid unique references public.profiles(user_id),
  employee_code text not null,
  full_name text not null,
  work_email citext not null,
  department text not null default 'General',
  branch_id uuid not null references public.branches(id),
  manager_id uuid references public.employees(id),
  policy_id uuid not null references public.attendance_policies(id),
  joined_on date not null,
  last_working_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_code),
  unique (organization_id, work_email),
  check (last_working_on is null or last_working_on >= joined_on),
  check (manager_id is null or manager_id <> id)
);

alter table public.profiles add column employee_id uuid unique references public.employees(id);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  holiday_date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (branch_id, holiday_date)
);

create table public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  branch_id uuid not null references public.branches(id),
  policy_id uuid not null references public.attendance_policies(id),
  calendar_context text not null check (calendar_context in ('working_day','holiday','weekly_off','outside_employment')),
  check_in_at timestamptz,
  check_out_at timestamptz,
  result public.attendance_result,
  duration_minutes integer,
  is_late boolean not null default false,
  is_early_departure boolean not null default false,
  work_mode text check (work_mode in ('office','client_visit','remote')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_id, work_date),
  check (check_out_at is null or check_in_at is not null),
  check (check_out_at is null or check_out_at > check_in_at)
);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  attendance_day_id uuid not null references public.attendance_days(id),
  actor_user_id uuid not null references auth.users(id),
  event_kind text not null check (event_kind in ('check_in','check_out','correction_approved','excused_set','excused_removed')),
  occurred_at timestamptz not null default now(),
  request_id uuid not null,
  payload jsonb not null default '{}',
  unique (organization_id, actor_user_id, event_kind, request_id)
);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  base_revision integer not null,
  proposed_check_in timestamptz not null,
  proposed_check_out timestamptz not null,
  reason text not null check (char_length(reason) between 10 and 500),
  state public.request_state not null default 'pending',
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  decision_reason text,
  request_id uuid not null,
  unique (organization_id, requested_by, request_id),
  check (proposed_check_out > proposed_check_in)
);
create unique index one_pending_correction_per_day on public.attendance_corrections(employee_id, work_date) where state = 'pending';

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  code text not null,
  default_days numeric(5,1) not null default 0 check (default_days >= 0),
  active boolean not null default true,
  unique (organization_id, code)
);

create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null references public.employees(id),
  leave_type_id uuid not null references public.leave_types(id),
  year integer not null,
  allocated numeric(5,1) not null default 0 check (allocated >= 0),
  used numeric(5,1) not null default 0 check (used >= 0 and used <= allocated),
  unique (employee_id, leave_type_id, year)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null references public.employees(id),
  leave_type_id uuid not null references public.leave_types(id),
  start_date date not null,
  end_date date not null,
  portion public.leave_portion not null default 'full_day',
  requested_days numeric(5,1) not null check (requested_days > 0),
  reason text not null check (char_length(reason) between 10 and 500),
  state public.request_state not null default 'pending',
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  decision_reason text,
  request_id uuid not null,
  unique (organization_id, requested_by, request_id),
  check (end_date >= start_date),
  check (portion = 'full_day' or start_date = end_date)
);
create index leave_requests_pending on public.leave_requests(organization_id, state, start_date);
create index attendance_days_employee_date on public.attendance_days(employee_id, work_date desc);
create index employees_manager on public.employees(manager_id) where active;

create table public.attendance_months (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  state public.month_state not null default 'open',
  revision integer not null default 1,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  unique (organization_id, month_start)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  request_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = public, auth as $$
  select organization_id from public.profiles where user_id = auth.uid() and active;
$$;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public, auth as $$
  select employee_id from public.profiles where user_id = auth.uid() and active;
$$;

create or replace function public.has_portal_role(roles public.portal_role[])
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists(select 1 from public.profiles where user_id = auth.uid() and active and role = any(roles));
$$;

create or replace function public.can_view_employee(target_employee_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.active and (
      p.employee_id = target_employee_id
      or p.role in ('admin','partner')
      or (p.role = 'manager' and exists(select 1 from public.employees e where e.id = target_employee_id and e.manager_id = p.employee_id))
    )
  );
$$;

create or replace function public.current_portal_identity()
returns table ("userId" uuid, "fullName" text, role public.portal_role, "employeeId" uuid, "organizationId" uuid)
language sql stable security definer set search_path = public, auth as $$
  select p.user_id, p.full_name, p.role, p.employee_id, p.organization_id
  from public.profiles p where p.user_id = auth.uid() and p.active;
$$;

create or replace function public.month_is_closed(p_org uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.attendance_months where organization_id = p_org and month_start = date_trunc('month', p_date)::date and state = 'closed');
$$;

create or replace function public.day_context(p_employee public.employees, p_date date)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_working smallint[]; v_dow int;
begin
  if p_date < p_employee.joined_on or (p_employee.last_working_on is not null and p_date > p_employee.last_working_on) then return 'outside_employment'; end if;
  if exists(select 1 from public.holidays where branch_id = p_employee.branch_id and holiday_date = p_date) then return 'holiday'; end if;
  select working_days into v_working from public.attendance_policies where id = p_employee.policy_id;
  v_dow := extract(isodow from p_date);
  if not (v_dow = any(v_working)) then return 'weekly_off'; end if;
  return 'working_day';
end;
$$;

create or replace function public.record_attendance_punch(p_kind text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_emp public.employees; v_policy public.attendance_policies; v_org public.organizations; v_date date; v_day public.attendance_days; v_now timestamptz := now(); v_minutes int; v_context text;
begin
  if p_kind not in ('check_in','check_out') then raise exception 'INVALID_INPUT: Unsupported punch.'; end if;
  select e.* into v_emp from public.employees e join public.profiles p on p.employee_id=e.id where p.user_id=auth.uid() and p.active and e.active;
  if v_emp.id is null then raise exception 'FORBIDDEN: Active employee profile required.'; end if;
  select * into v_org from public.organizations where id=v_emp.organization_id;
  v_date := (v_now at time zone v_org.timezone)::date;
  if public.month_is_closed(v_emp.organization_id, v_date) then raise exception 'MONTH_LOCKED: This month is closed.'; end if;
  select * into v_policy from public.attendance_policies where id=v_emp.policy_id;
  v_context := public.day_context(v_emp, v_date);
  if v_context='outside_employment' then raise exception 'OUTSIDE_EMPLOYMENT: Attendance is unavailable for this date.'; end if;

  insert into public.attendance_days(organization_id, employee_id, work_date, branch_id, policy_id, calendar_context)
  values(v_emp.organization_id, v_emp.id, v_date, v_emp.branch_id, v_emp.policy_id, v_context)
  on conflict(organization_id, employee_id, work_date) do nothing;

  select * into v_day from public.attendance_days where organization_id=v_emp.organization_id and employee_id=v_emp.id and work_date=v_date for update;

  if exists(select 1 from public.attendance_events where organization_id=v_emp.organization_id and actor_user_id=auth.uid() and event_kind=p_kind and request_id=p_request_id) then
    return to_jsonb(v_day);
  end if;

  if p_kind='check_in' then
    if v_day.check_in_at is not null then raise exception 'ALREADY_PUNCHED: Check-in already exists.'; end if;
    update public.attendance_days set check_in_at=v_now, is_late=(v_context='working_day' and (v_now at time zone v_org.timezone)::time > v_policy.shift_start + make_interval(mins=>v_policy.grace_minutes)), result=null, updated_at=v_now, revision=revision+1 where id=v_day.id returning * into v_day;
  else
    if v_day.check_in_at is null then raise exception 'NO_CHECK_IN: Check in before checking out.'; end if;
    if v_day.check_out_at is not null then raise exception 'ALREADY_PUNCHED: Check-out already exists.'; end if;
    v_minutes := floor(extract(epoch from (v_now-v_day.check_in_at))/60);
    update public.attendance_days set check_out_at=v_now, duration_minutes=v_minutes,
      result=case when v_context<>'working_day' then 'not_applicable'::public.attendance_result when v_minutes>=v_policy.full_day_minutes then 'full_day'::public.attendance_result when v_minutes>=v_policy.half_day_minutes then 'half_day'::public.attendance_result else 'short_day'::public.attendance_result end,
      is_early_departure=(v_context='working_day' and (v_now at time zone v_org.timezone)::time < v_policy.shift_end),
      updated_at=v_now, revision=revision+1 where id=v_day.id returning * into v_day;
  end if;

  insert into public.attendance_events(organization_id, attendance_day_id, actor_user_id, event_kind, request_id) values(v_emp.organization_id, v_day.id, auth.uid(), p_kind, p_request_id);
  insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id) values(v_emp.organization_id, auth.uid(), p_kind, 'attendance_day', v_day.id::text, p_request_id);
  return to_jsonb(v_day);
end;
$$;

create or replace function public.request_attendance_correction(p_work_date date, p_check_in time, p_check_out time, p_reason text, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_emp public.employees; v_day public.attendance_days; v_policy public.attendance_policies; v_org public.organizations; v_id uuid; v_in timestamptz; v_out timestamptz;
begin
  select e.* into v_emp from public.employees e join public.profiles p on p.employee_id=e.id where p.user_id=auth.uid() and p.active;
  if v_emp.id is null then raise exception 'FORBIDDEN: Employee profile required.'; end if;
  select * into v_org from public.organizations where id=v_emp.organization_id;
  select * into v_policy from public.attendance_policies where id=v_emp.policy_id;
  if p_work_date > (now() at time zone v_org.timezone)::date or p_work_date < ((now() at time zone v_org.timezone)::date-v_policy.correction_window_days) then raise exception 'INVALID_INPUT: Date is outside the correction window.'; end if;
  if p_check_out <= p_check_in then raise exception 'INVALID_INPUT: Check-out must be after check-in.'; end if;
  if char_length(trim(p_reason)) not between 10 and 500 then raise exception 'INVALID_INPUT: Reason must be 10 to 500 characters.'; end if;
  if public.month_is_closed(v_emp.organization_id,p_work_date) then raise exception 'MONTH_LOCKED: This month is closed.'; end if;
  insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context)
  values(v_emp.organization_id,v_emp.id,p_work_date,v_emp.branch_id,v_emp.policy_id,public.day_context(v_emp,p_work_date))
  on conflict(organization_id,employee_id,work_date) do nothing;
  select * into v_day from public.attendance_days where employee_id=v_emp.id and work_date=p_work_date;
  v_in := (p_work_date+p_check_in) at time zone v_org.timezone; v_out := (p_work_date+p_check_out) at time zone v_org.timezone;
  insert into public.attendance_corrections(organization_id,employee_id,work_date,base_revision,proposed_check_in,proposed_check_out,reason,requested_by,request_id)
  values(v_emp.organization_id,v_emp.id,p_work_date,v_day.revision,v_in,v_out,trim(p_reason),auth.uid(),p_request_id) returning id into v_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v_emp.organization_id,auth.uid(),'correction_requested','attendance_correction',v_id::text,p_request_id);
  return v_id;
end;
$$;

create or replace function public.leave_working_days(p_employee public.employees, p_start date, p_end date, p_portion public.leave_portion)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare v_count numeric;
begin
  if p_portion <> 'full_day' then
    if p_start<>p_end or public.day_context(p_employee,p_start)<>'working_day' then return 0; end if;
    return 0.5;
  end if;
  select count(*)::numeric into v_count from generate_series(p_start,p_end,'1 day'::interval) d where public.day_context(p_employee,d::date)='working_day';
  return v_count;
end;
$$;

create or replace function public.submit_leave_request(p_leave_type_id uuid,p_start_date date,p_end_date date,p_portion public.leave_portion,p_reason text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_emp public.employees; v_days numeric; v_balance public.leave_balances; v_id uuid;
begin
  select e.* into v_emp from public.employees e join public.profiles p on p.employee_id=e.id where p.user_id=auth.uid() and p.active and e.active;
  if v_emp.id is null then raise exception 'FORBIDDEN: Active employee required.'; end if;
  if p_end_date<p_start_date or p_start_date<current_date then raise exception 'INVALID_INPUT: Choose a valid current or future date range.'; end if;
  if p_portion<>'full_day' and p_start_date<>p_end_date then raise exception 'INVALID_INPUT: Half-day leave covers one date.'; end if;
  if char_length(trim(p_reason)) not between 10 and 500 then raise exception 'INVALID_INPUT: Reason must be 10 to 500 characters.'; end if;
  if not exists(select 1 from public.leave_types where id=p_leave_type_id and organization_id=v_emp.organization_id and active) then raise exception 'INVALID_INPUT: Leave type is unavailable.'; end if;
  if exists(select 1 from public.leave_requests where employee_id=v_emp.id and state in ('pending','approved') and daterange(start_date,end_date,'[]') && daterange(p_start_date,p_end_date,'[]')) then raise exception 'INVALID_INPUT: This date range overlaps another leave request.'; end if;
  v_days := public.leave_working_days(v_emp,p_start_date,p_end_date,p_portion);
  if v_days<=0 then raise exception 'INVALID_INPUT: The selected dates contain no working time.'; end if;
  select * into v_balance from public.leave_balances where employee_id=v_emp.id and leave_type_id=p_leave_type_id and year=extract(year from p_start_date) for update;
  if v_balance.id is null or v_balance.allocated-v_balance.used<v_days then raise exception 'INVALID_INPUT: Insufficient leave balance.'; end if;
  insert into public.leave_requests(organization_id,employee_id,leave_type_id,start_date,end_date,portion,requested_days,reason,requested_by,request_id)
  values(v_emp.organization_id,v_emp.id,p_leave_type_id,p_start_date,p_end_date,p_portion,v_days,trim(p_reason),auth.uid(),p_request_id) returning id into v_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v_emp.organization_id,auth.uid(),'leave_requested','leave_request',v_id::text,p_request_id);
  return v_id;
end;
$$;

create or replace function public.is_reviewer_for(p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.active and p.employee_id<>p_employee_id and (p.role in ('admin','partner') or (p.role='manager' and exists(select 1 from public.employees e where e.id=p_employee_id and e.manager_id=p.employee_id))));
$$;

create or replace function public.decide_leave_request(p_id uuid,p_decision text,p_reason text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare v_req public.leave_requests; v_bal public.leave_balances;
begin
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_INPUT: Invalid decision.'; end if;
  select * into v_req from public.leave_requests where id=p_id for update;
  if v_req.id is null or not public.is_reviewer_for(v_req.employee_id) then raise exception 'FORBIDDEN: You cannot review this request.'; end if;
  if v_req.state<>'pending' then raise exception 'STALE_REVISION: Request is already decided.'; end if;
  if p_decision='rejected' and char_length(trim(p_reason))<3 then raise exception 'INVALID_INPUT: Rejection reason required.'; end if;
  if p_decision='approved' then
    select * into v_bal from public.leave_balances where employee_id=v_req.employee_id and leave_type_id=v_req.leave_type_id and year=extract(year from v_req.start_date) for update;
    if v_bal.id is null or v_bal.allocated-v_bal.used<v_req.requested_days then raise exception 'INVALID_INPUT: Leave balance changed and is now insufficient.'; end if;
    update public.leave_balances set used=used+v_req.requested_days where id=v_bal.id;
  end if;
  update public.leave_requests set state=p_decision::public.request_state,reviewed_by=auth.uid(),reviewed_at=now(),decision_reason=nullif(trim(p_reason),'') where id=p_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v_req.organization_id,auth.uid(),'leave_'||p_decision,'leave_request',p_id::text,p_request_id);
end;
$$;

create or replace function public.decide_attendance_correction(p_id uuid,p_decision text,p_reason text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare v_req public.attendance_corrections; v_day public.attendance_days; v_policy public.attendance_policies; v_minutes int;
begin
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_INPUT: Invalid decision.'; end if;
  select * into v_req from public.attendance_corrections where id=p_id for update;
  if v_req.id is null or not public.is_reviewer_for(v_req.employee_id) then raise exception 'FORBIDDEN: You cannot review this correction.'; end if;
  if v_req.state<>'pending' then raise exception 'STALE_REVISION: Correction is already decided.'; end if;
  select * into v_day from public.attendance_days where employee_id=v_req.employee_id and work_date=v_req.work_date for update;
  if v_day.revision<>v_req.base_revision then raise exception 'STALE_REVISION: Attendance changed; reload the request.'; end if;
  if public.month_is_closed(v_req.organization_id,v_req.work_date) then raise exception 'MONTH_LOCKED: This month is closed.'; end if;
  if p_decision='rejected' and char_length(trim(p_reason))<3 then raise exception 'INVALID_INPUT: Rejection reason required.'; end if;
  if p_decision='approved' then
    select * into v_policy from public.attendance_policies where id=v_day.policy_id;
    v_minutes:=floor(extract(epoch from (v_req.proposed_check_out-v_req.proposed_check_in))/60);
    update public.attendance_days set check_in_at=v_req.proposed_check_in,check_out_at=v_req.proposed_check_out,duration_minutes=v_minutes,
      result=case when calendar_context<>'working_day' then 'not_applicable'::public.attendance_result when v_minutes>=v_policy.full_day_minutes then 'full_day'::public.attendance_result when v_minutes>=v_policy.half_day_minutes then 'half_day'::public.attendance_result else 'short_day'::public.attendance_result end,
      is_late=((v_req.proposed_check_in at time zone (select timezone from public.organizations where id=v_req.organization_id))::time > v_policy.shift_start+make_interval(mins=>v_policy.grace_minutes)),
      is_early_departure=((v_req.proposed_check_out at time zone (select timezone from public.organizations where id=v_req.organization_id))::time<v_policy.shift_end),
      revision=revision+1,updated_at=now() where id=v_day.id;
  end if;
  update public.attendance_corrections set state=p_decision::public.request_state,reviewed_by=auth.uid(),reviewed_at=now(),decision_reason=nullif(trim(p_reason),'') where id=p_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v_req.organization_id,auth.uid(),'correction_'||p_decision,'attendance_correction',p_id::text,p_request_id);
end;
$$;

create or replace function public.dashboard_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_emp public.employees; v_org public.organizations; v_policy public.attendance_policies; v_date date; v_day public.attendance_days;
begin
  select e.* into v_emp from public.employees e join public.profiles p on p.employee_id=e.id where p.user_id=auth.uid() and p.active;
  if v_emp.id is null then raise exception 'FORBIDDEN: Employee profile required.'; end if;
  select * into v_org from public.organizations where id=v_emp.organization_id; select * into v_policy from public.attendance_policies where id=v_emp.policy_id;
  v_date:=(now() at time zone v_org.timezone)::date;
  select * into v_day from public.attendance_days where employee_id=v_emp.id and work_date=v_date;
  return jsonb_build_object(
    'today',jsonb_build_object('workDate',v_date,'state',case when v_day.check_out_at is not null then 'complete' when v_day.check_in_at is not null then 'open' else 'not_started' end,'checkIn',v_day.check_in_at,'checkOut',v_day.check_out_at,'shiftLabel',to_char(v_policy.shift_start,'HH12:MI AM')||' – '||to_char(v_policy.shift_end,'HH12:MI AM'),'canCheckIn',v_day.check_in_at is null,'canCheckOut',v_day.check_in_at is not null and v_day.check_out_at is null),
    'stats',jsonb_build_object('present',(select count(*) from public.attendance_days where organization_id=v_emp.organization_id and work_date=v_date and check_in_at is not null),'expected',(select count(*) from public.employees where organization_id=v_emp.organization_id and active and joined_on<=v_date and (last_working_on is null or last_working_on>=v_date)),'onLeave',(select count(*) from public.leave_requests where organization_id=v_emp.organization_id and state='approved' and v_date between start_date and end_date),'pendingApprovals',(select count(*) from public.leave_requests where organization_id=v_emp.organization_id and state='pending' and public.is_reviewer_for(employee_id))+(select count(*) from public.attendance_corrections where organization_id=v_emp.organization_id and state='pending' and public.is_reviewer_for(employee_id))),
    'recent',coalesce((select jsonb_agg(jsonb_build_object('date',to_char(work_date,'DD Mon'),'checkIn',to_char(check_in_at at time zone v_org.timezone,'HH12:MI AM'),'checkOut',to_char(check_out_at at time zone v_org.timezone,'HH12:MI AM'),'duration',case when duration_minutes is null then '—' else (duration_minutes/60)||'h '||(duration_minutes%60)||'m' end,'result',coalesce(result::text,case when check_in_at is not null then 'open' else 'absent' end)) order by work_date desc) from (select * from public.attendance_days where employee_id=v_emp.id order by work_date desc limit 5) d),'[]'::jsonb),
    'leaveBalances',coalesce((select jsonb_agg(jsonb_build_object('name',lt.name,'allocated',lb.allocated,'used',lb.used,'available',lb.allocated-lb.used)) from public.leave_balances lb join public.leave_types lt on lt.id=lb.leave_type_id where lb.employee_id=v_emp.id and lb.year=extract(year from v_date)),'[]'::jsonb)
  );
end;
$$;

create or replace function public.my_attendance_history(p_month text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select coalesce(jsonb_agg(jsonb_build_object('date',to_char(d.work_date,'DD Mon YYYY'),'context',d.calendar_context,'checkIn',to_char(d.check_in_at at time zone o.timezone,'HH12:MI AM'),'checkOut',to_char(d.check_out_at at time zone o.timezone,'HH12:MI AM'),'duration',case when d.duration_minutes is null then '—' else (d.duration_minutes/60)||'h '||(d.duration_minutes%60)||'m' end,'result',coalesce(d.result::text,case when d.check_in_at is not null then 'open' else 'absent' end),'isLate',d.is_late,'correctionStatus',(select c.state::text from public.attendance_corrections c where c.employee_id=d.employee_id and c.work_date=d.work_date order by c.requested_at desc limit 1)) order by d.work_date desc),'[]'::jsonb)
  from public.attendance_days d join public.organizations o on o.id=d.organization_id
  where d.employee_id=public.current_employee_id() and to_char(d.work_date,'YYYY-MM')=p_month;
$$;

create or replace function public.my_leave_snapshot()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select jsonb_build_object(
    'types',coalesce((select jsonb_agg(jsonb_build_object('id',lt.id,'name',lt.name,'allocated',coalesce(lb.allocated,0),'used',coalesce(lb.used,0),'available',coalesce(lb.allocated-lb.used,0)) order by lt.name) from public.leave_types lt left join public.leave_balances lb on lb.leave_type_id=lt.id and lb.employee_id=public.current_employee_id() and lb.year=extract(year from current_date) where lt.organization_id=public.current_organization_id() and lt.active),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',lr.id,'type',lt.name,'dates',to_char(lr.start_date,'DD Mon')||case when lr.end_date<>lr.start_date then ' – '||to_char(lr.end_date,'DD Mon') else '' end,'days',lr.requested_days,'state',lr.state,'submittedAt',lr.requested_at) order by lr.requested_at desc) from public.leave_requests lr join public.leave_types lt on lt.id=lr.leave_type_id where lr.employee_id=public.current_employee_id()),'[]'::jsonb)
  );
$$;

create or replace function public.pending_approvals()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select coalesce(jsonb_agg(x.item order by x.submitted_at),'[]'::jsonb) from (
    select lr.requested_at submitted_at,jsonb_build_object('id',lr.id,'kind','leave','employee',e.full_name,'summary',lt.name||': '||to_char(lr.start_date,'DD Mon')||' – '||to_char(lr.end_date,'DD Mon')||' ('||lr.requested_days||' days)','reason',lr.reason,'submittedAt',lr.requested_at) item from public.leave_requests lr join public.employees e on e.id=lr.employee_id join public.leave_types lt on lt.id=lr.leave_type_id where lr.state='pending' and public.is_reviewer_for(lr.employee_id)
    union all
    select ac.requested_at,jsonb_build_object('id',ac.id,'kind','attendance','employee',e.full_name,'summary',to_char(ac.work_date,'DD Mon YYYY')||': '||to_char(ac.proposed_check_in at time zone o.timezone,'HH12:MI AM')||' – '||to_char(ac.proposed_check_out at time zone o.timezone,'HH12:MI AM'),'reason',ac.reason,'submittedAt',ac.requested_at) from public.attendance_corrections ac join public.employees e on e.id=ac.employee_id join public.organizations o on o.id=ac.organization_id where ac.state='pending' and public.is_reviewer_for(ac.employee_id)
  ) x;
$$;

create or replace function public.employee_directory()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select case when public.has_portal_role(array['admin','partner']::public.portal_role[]) then coalesce(jsonb_agg(jsonb_build_object('id',e.id,'code',e.employee_code,'name',e.full_name,'email',e.work_email,'department',e.department,'branch',b.name,'manager',m.full_name,'status',case when e.active then 'active' else 'inactive' end) order by e.full_name),'[]'::jsonb) else '[]'::jsonb end
  from public.employees e join public.branches b on b.id=e.branch_id left join public.employees m on m.id=e.manager_id where e.organization_id=public.current_organization_id();
$$;

create or replace function public.attendance_month_summary(p_month text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
  with scoped as (select d.* from public.attendance_days d where d.organization_id=public.current_organization_id() and to_char(d.work_date,'YYYY-MM')=p_month and (public.has_portal_role(array['admin','partner']::public.portal_role[]) or public.can_view_employee(d.employee_id)))
  select jsonb_build_object('expectedDays',count(*) filter(where calendar_context='working_day'),'fullDays',count(*) filter(where result='full_day'),'halfDays',count(*) filter(where result='half_day'),'shortDays',count(*) filter(where result='short_day'),'absentDays',count(*) filter(where result='absent'),'leaveDays',(select coalesce(sum(requested_days),0) from public.leave_requests where organization_id=public.current_organization_id() and state='approved' and to_char(start_date,'YYYY-MM')=p_month),'incompleteDays',count(*) filter(where check_in_at is not null and check_out_at is null),'totalHours',(coalesce(sum(duration_minutes),0)/60)||'h','isClosed',public.month_is_closed(public.current_organization_id(),(p_month||'-01')::date),'blockers',count(*) filter(where check_in_at is not null and check_out_at is null)+(select count(*) from public.attendance_corrections where organization_id=public.current_organization_id() and state='pending' and to_char(work_date,'YYYY-MM')=p_month)) from scoped;
$$;

create or replace function public.attendance_settings_snapshot()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select jsonb_build_object('organization',o.name,'timezone',o.timezone,'branch',b.name,'workDays','Monday – Saturday','shift',to_char(p.shift_start,'HH12:MI AM')||' – '||to_char(p.shift_end,'HH12:MI AM'),'grace',p.grace_minutes,'fullDay',p.full_day_minutes,'halfDay',p.half_day_minutes,'correctionWindow',p.correction_window_days,'leaveTypes',coalesce((select jsonb_agg(name order by name) from public.leave_types where organization_id=o.id and active),'[]'::jsonb))
  from public.organizations o join public.branches b on b.organization_id=o.id join public.attendance_policies p on p.organization_id=o.id where o.id=public.current_organization_id() order by p.effective_from desc limit 1;
$$;

alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.attendance_policies enable row level security;
alter table public.holidays enable row level security;
alter table public.attendance_days enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
alter table public.attendance_months enable row level security;
alter table public.audit_logs enable row level security;

create policy organization_read on public.organizations for select to authenticated using(id=public.current_organization_id());
create policy branch_read on public.branches for select to authenticated using(organization_id=public.current_organization_id());
create policy profile_self on public.profiles for select to authenticated using(user_id=auth.uid() or (organization_id=public.current_organization_id() and public.has_portal_role(array['admin','partner']::public.portal_role[])));
create policy employee_scoped_read on public.employees for select to authenticated using(organization_id=public.current_organization_id() and public.can_view_employee(id));
create policy policy_read on public.attendance_policies for select to authenticated using(organization_id=public.current_organization_id());
create policy holiday_read on public.holidays for select to authenticated using(organization_id=public.current_organization_id());
create policy attendance_scoped_read on public.attendance_days for select to authenticated using(organization_id=public.current_organization_id() and public.can_view_employee(employee_id));
create policy event_scoped_read on public.attendance_events for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.attendance_days d where d.id=attendance_day_id and public.can_view_employee(d.employee_id)));
create policy correction_scoped_read on public.attendance_corrections for select to authenticated using(organization_id=public.current_organization_id() and (public.can_view_employee(employee_id) or requested_by=auth.uid()));
create policy leave_type_read on public.leave_types for select to authenticated using(organization_id=public.current_organization_id());
create policy balance_scoped_read on public.leave_balances for select to authenticated using(organization_id=public.current_organization_id() and public.can_view_employee(employee_id));
create policy leave_scoped_read on public.leave_requests for select to authenticated using(organization_id=public.current_organization_id() and (public.can_view_employee(employee_id) or requested_by=auth.uid()));
create policy month_read on public.attendance_months for select to authenticated using(organization_id=public.current_organization_id());
create policy audit_admin_read on public.audit_logs for select to authenticated using(organization_id=public.current_organization_id() and public.has_portal_role(array['admin','partner']::public.portal_role[]));

revoke all on all functions in schema public from public, anon;
grant execute on function public.current_portal_identity() to authenticated;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.has_portal_role(public.portal_role[]) to authenticated;
grant execute on function public.can_view_employee(uuid) to authenticated;
grant execute on function public.month_is_closed(uuid,date) to authenticated;
grant execute on function public.is_reviewer_for(uuid) to authenticated;
grant execute on function public.dashboard_snapshot() to authenticated;
grant execute on function public.my_attendance_history(text) to authenticated;
grant execute on function public.my_leave_snapshot() to authenticated;
grant execute on function public.pending_approvals() to authenticated;
grant execute on function public.employee_directory() to authenticated;
grant execute on function public.attendance_month_summary(text) to authenticated;
grant execute on function public.attendance_settings_snapshot() to authenticated;
grant execute on function public.record_attendance_punch(text,uuid) to authenticated;
grant execute on function public.request_attendance_correction(date,time,time,text,uuid) to authenticated;
grant execute on function public.submit_leave_request(uuid,date,date,public.leave_portion,text,uuid) to authenticated;
grant execute on function public.decide_leave_request(uuid,text,text,uuid) to authenticated;
grant execute on function public.decide_attendance_correction(uuid,text,text,uuid) to authenticated;

do $$
declare v_org uuid; v_branch uuid; v_policy uuid;
begin
  insert into public.organizations(name,timezone) values('P S B & Associates LLP','Asia/Kolkata') returning id into v_org;
  insert into public.branches(organization_id,name,timezone) values(v_org,'Chhatrapati Sambhajinagar','Asia/Kolkata') returning id into v_branch;
  insert into public.attendance_policies(organization_id,name,effective_from) values(v_org,'Default attendance policy',current_date) returning id into v_policy;
  insert into public.leave_types(organization_id,name,code,default_days) values(v_org,'Casual Leave','CL',12),(v_org,'Sick Leave','SL',8),(v_org,'Privilege Leave','PL',15);
end $$;
