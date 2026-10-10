-- Reconciliation and immutable month snapshots.

create table public.attendance_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  month_start date not null,
  version integer not null,
  summary jsonb not null,
  detail jsonb not null,
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now(),
  unique (organization_id, month_start, version)
);
alter table public.attendance_report_snapshots enable row level security;
create policy report_snapshot_read on public.attendance_report_snapshots for select to authenticated
  using (organization_id=public.current_organization_id() and (public.has_portal_role(array['admin','partner']::public.portal_role[]) or public.has_portal_role(array['manager']::public.portal_role[])));

create or replace function public.reconcile_attendance_date(p_date date,p_org uuid default null)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_emp public.employees; v_context text; v_count int:=0; v_result public.attendance_result;
begin
  for v_emp in select * from public.employees where (p_org is null or organization_id=p_org) and joined_on<=p_date and (last_working_on is null or last_working_on>=p_date) loop
    v_context:=public.day_context(v_emp,p_date);
    v_result:=case
      when v_context<>'working_day' then 'not_applicable'::public.attendance_result
      when exists(select 1 from public.leave_requests where employee_id=v_emp.id and state='approved' and portion='full_day' and p_date between start_date and end_date) then 'excused'::public.attendance_result
      else 'absent'::public.attendance_result end;
    insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context,result)
    values(v_emp.organization_id,v_emp.id,p_date,v_emp.branch_id,v_emp.policy_id,v_context,v_result)
    on conflict(organization_id,employee_id,work_date) do update set
      result=case when attendance_days.check_in_at is null and attendance_days.check_out_at is null then excluded.result else attendance_days.result end,
      updated_at=case when attendance_days.check_in_at is null and attendance_days.check_out_at is null and attendance_days.result is distinct from excluded.result then now() else attendance_days.updated_at end;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.reconcile_attendance_month(p_org uuid,p_month date)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_date date;v_last date;v_count int:=0;
begin
  v_last:=least((p_month+interval '1 month'-interval '1 day')::date,(now() at time zone (select timezone from public.organizations where id=p_org))::date-1);
  if v_last<p_month then return 0; end if;
  for v_date in select generate_series(p_month,v_last,'1 day'::interval)::date loop
    v_count:=v_count+public.reconcile_attendance_date(v_date,p_org);
  end loop;
  return v_count;
end;
$$;

create or replace function public.close_attendance_month(p_month text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid;v_start date:=(p_month||'-01')::date;v_blockers int;v_revision int;v_summary jsonb;v_detail jsonb;
begin
  perform public.assert_admin();v_org:=public.current_organization_id();
  if v_start>=date_trunc('month',(now() at time zone (select timezone from public.organizations where id=v_org))::date)::date then raise exception 'INVALID_INPUT: Only completed months can be closed.'; end if;
  insert into public.attendance_months(organization_id,month_start) values(v_org,v_start) on conflict do nothing;
  perform 1 from public.attendance_months where organization_id=v_org and month_start=v_start for update;
  perform public.reconcile_attendance_month(v_org,v_start);
  select (select count(*) from public.attendance_days where organization_id=v_org and work_date>=v_start and work_date<(v_start+interval '1 month') and check_in_at is not null and check_out_at is null)
    +(select count(*) from public.attendance_corrections where organization_id=v_org and work_date>=v_start and work_date<(v_start+interval '1 month') and state='pending') into v_blockers;
  if v_blockers>0 then raise exception 'INVALID_INPUT: Resolve % blocking records first.',v_blockers; end if;
  update public.attendance_months set state='closed',revision=revision+1,closed_at=now(),closed_by=auth.uid()
    where organization_id=v_org and month_start=v_start returning revision into v_revision;
  v_summary:=public.attendance_month_summary(p_month);
  v_detail:=public.attendance_export_rows(p_month);
  insert into public.attendance_report_snapshots(organization_id,month_start,version,summary,detail,generated_by)
    values(v_org,v_start,v_revision,v_summary,v_detail,auth.uid());
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
    values(v_org,auth.uid(),'month_closed','attendance_month',p_month,p_request_id,jsonb_build_object('reportVersion',v_revision));
end;
$$;

grant execute on function public.reconcile_attendance_date(date,uuid) to postgres, service_role;
grant execute on function public.reconcile_attendance_month(uuid,date) to postgres, service_role;
grant select on public.attendance_report_snapshots to authenticated;

create extension if not exists pg_cron;
do $$
begin
  if not exists(select 1 from cron.job where jobname='psb-daily-attendance-reconciliation') then
    perform cron.schedule('psb-daily-attendance-reconciliation','45 18 * * *',$job$select public.reconcile_attendance_date(((now() at time zone 'Asia/Kolkata')::date-1));$job$);
  end if;
end $$;

