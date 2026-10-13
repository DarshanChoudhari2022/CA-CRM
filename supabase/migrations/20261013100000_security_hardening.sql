-- Apply transactionally. Onboarding identity and profile-self reads deliberately
-- remain available; protected helpers fail closed until password change completes.
create function public.portal_access_allowed()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(
  select 1 from public.profiles p where p.user_id=auth.uid() and p.active and not p.password_change_required
  and (p.employee_id is null or exists(select 1 from public.employees e
   where e.id=p.employee_id and e.organization_id=p.organization_id and e.active))
 );
$$;
revoke all on function public.portal_access_allowed() from public,anon,authenticated;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public,auth as $$
 select organization_id from public.profiles where user_id=auth.uid() and public.portal_access_allowed();
$$;
create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path=public,auth as $$
 select employee_id from public.profiles where user_id=auth.uid() and public.portal_access_allowed();
$$;
create or replace function public.has_portal_role(roles public.portal_role[])
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles where user_id=auth.uid()
  and public.portal_access_allowed() and role=any(roles));
$$;
create or replace function public.can_view_employee(target_employee_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p
  join public.employees e on e.id=target_employee_id and e.organization_id=p.organization_id
  where p.user_id=auth.uid() and public.portal_access_allowed()
  and (p.employee_id=e.id or p.role in ('admin','partner') or (p.role='manager' and e.manager_id=p.employee_id)));
$$;
create or replace function public.is_reviewer_for(p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p
  join public.employees e on e.id=p_employee_id and e.organization_id=p.organization_id
  where p.user_id=auth.uid() and public.portal_access_allowed() and p.employee_id<>p_employee_id
  and (p.role in ('admin','partner') or (p.role='manager' and e.manager_id=p.employee_id)));
$$;
revoke all on function public.current_organization_id(),public.current_employee_id(),
 public.has_portal_role(public.portal_role[]),public.can_view_employee(uuid),public.is_reviewer_for(uuid)
 from public,anon;
grant execute on function public.current_organization_id(),public.current_employee_id(),
 public.has_portal_role(public.portal_role[]),public.can_view_employee(uuid),public.is_reviewer_for(uuid)
 to authenticated;

alter policy report_snapshot_read on public.attendance_report_snapshots using(
 organization_id=(select public.current_organization_id())
 and (select public.has_portal_role(array['admin','partner']::public.portal_role[]))
);

-- These three legacy write RPCs query profiles directly instead of the protected
-- helpers. Guard their writes without replacing their concurrency/domain logic.
-- Trusted cron/service operations without a user subject must remain possible.
create function public.attendance_require_portal_access()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
 if auth.uid() is not null and not public.portal_access_allowed() then
  raise exception 'FORBIDDEN: Active workspace access and password change required';
 end if;
 return new;
end $$;
revoke all on function public.attendance_require_portal_access() from public,anon,authenticated;
create trigger attendance_day_access before insert or update on public.attendance_days
 for each row execute function public.attendance_require_portal_access();
create trigger attendance_correction_access before insert or update on public.attendance_corrections
 for each row execute function public.attendance_require_portal_access();
create trigger leave_request_access before insert or update on public.leave_requests
 for each row execute function public.attendance_require_portal_access();

-- The old dashboard is still callable directly, including by dashboard_snapshot_v2.
create or replace function public.dashboard_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_emp public.employees; v_org public.organizations; v_policy public.attendance_policies; v_date date; v_day public.attendance_days;
begin
 select * into v_emp from public.employees where id=public.current_employee_id();
 if v_emp.id is null then raise exception 'FORBIDDEN: Active onboarded employee profile required.'; end if;
 select * into v_org from public.organizations where id=v_emp.organization_id; select * into v_policy from public.attendance_policies where id=v_emp.policy_id;
 v_date:=(now() at time zone v_org.timezone)::date;
 select * into v_day from public.attendance_days where employee_id=v_emp.id and work_date=v_date;
 return jsonb_build_object(
  'today',jsonb_build_object('workDate',v_date,'state',case when v_day.check_out_at is not null then 'complete' when v_day.check_in_at is not null then 'open' else 'not_started' end,'checkIn',v_day.check_in_at,'checkOut',v_day.check_out_at,'shiftLabel',to_char(v_policy.shift_start,'HH12:MI AM')||' – '||to_char(v_policy.shift_end,'HH12:MI AM'),'canCheckIn',v_day.check_in_at is null,'canCheckOut',v_day.check_in_at is not null and v_day.check_out_at is null),
  'stats',jsonb_build_object('present',(select count(*) from public.attendance_days where organization_id=v_emp.organization_id and work_date=v_date and check_in_at is not null),'expected',(select count(*) from public.employees where organization_id=v_emp.organization_id and active and joined_on<=v_date and (last_working_on is null or last_working_on>=v_date)),'onLeave',(select count(*) from public.leave_requests where organization_id=v_emp.organization_id and state='approved' and v_date between start_date and end_date),'pendingApprovals',(select count(*) from public.leave_requests where organization_id=v_emp.organization_id and state='pending' and public.is_reviewer_for(employee_id))+(select count(*) from public.attendance_corrections where organization_id=v_emp.organization_id and state='pending' and public.is_reviewer_for(employee_id))),
  'recent',coalesce((select jsonb_agg(jsonb_build_object('date',to_char(work_date,'DD Mon'),'checkIn',to_char(check_in_at at time zone v_org.timezone,'HH12:MI AM'),'checkOut',to_char(check_out_at at time zone v_org.timezone,'HH12:MI AM'),'duration',case when duration_minutes is null then '—' else (duration_minutes/60)||'h '||(duration_minutes%60)||'m' end,'result',coalesce(result::text,case when check_in_at is not null then 'open' else 'absent' end)) order by work_date desc) from (select * from public.attendance_days where employee_id=v_emp.id order by work_date desc limit 5) d),'[]'::jsonb),
  'leaveBalances',coalesce((select jsonb_agg(jsonb_build_object('name',lt.name,'allocated',lb.allocated,'used',lb.used,'available',lb.allocated-lb.used)) from public.leave_balances lb join public.leave_types lt on lt.id=lb.leave_type_id where lb.employee_id=v_emp.id and lb.year=extract(year from v_date)),'[]'::jsonb)
 );
end $$;

revoke all on function public.dashboard_snapshot() from public,anon;
grant execute on function public.dashboard_snapshot() to authenticated;

create or replace function public.reconcile_attendance_date(p_date date,p_org uuid default null)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_emp public.employees; v_context text; v_count int:=0; v_result public.attendance_result;
begin
 if p_date is null or exists(select 1 from public.organizations
  where (p_org is null or id=p_org) and p_date>(now() at time zone timezone)::date) then
  raise exception 'INVALID_INPUT: Reconciliation requires a current or past local date';
 end if;
 for v_emp in select * from public.employees where (p_org is null or organization_id=p_org) and joined_on<=p_date and (last_working_on is null or last_working_on>=p_date) loop
  if public.month_is_closed(v_emp.organization_id,p_date) then continue; end if;
  v_context:=public.day_context(v_emp,p_date);
  v_result:=case when v_context<>'working_day' then 'not_applicable'::public.attendance_result
   when exists(select 1 from public.leave_requests where employee_id=v_emp.id and state='approved' and portion='full_day' and p_date between start_date and end_date) then 'excused'::public.attendance_result else 'absent'::public.attendance_result end;
  insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context,result)
  values(v_emp.organization_id,v_emp.id,p_date,v_emp.branch_id,v_emp.policy_id,v_context,v_result)
  on conflict(organization_id,employee_id,work_date) do update set
   result=case when attendance_days.check_in_at is null and attendance_days.check_out_at is null then case when attendance_days.excuse_reason is not null then 'excused'::public.attendance_result else excluded.result end else attendance_days.result end,
   updated_at=case when attendance_days.check_in_at is null and attendance_days.check_out_at is null and attendance_days.excuse_reason is null and attendance_days.result is distinct from excluded.result then now() else attendance_days.updated_at end;
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;

create or replace function public.reconcile_attendance_month(p_org uuid,p_month date)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_date date; v_last date; v_count int:=0; v_today date;
begin
 select (now() at time zone timezone)::date into v_today from public.organizations where id=p_org;
 if v_today is null or p_month is null or p_month<>date_trunc('month',p_month)::date
  or p_month>date_trunc('month',v_today)::date then
  raise exception 'INVALID_INPUT: Reconciliation requires a valid organization and current or past month';
 end if;
 v_last:=least((p_month+interval '1 month'-interval '1 day')::date,v_today-1);
 if v_last<p_month then return 0; end if;
 for v_date in select generate_series(p_month,v_last,'1 day'::interval)::date loop
  v_count:=v_count+public.reconcile_attendance_date(v_date,p_org);
 end loop;
 return v_count;
end $$;
revoke all on function public.reconcile_attendance_date(date,uuid),public.reconcile_attendance_month(uuid,date)
 from public,anon,authenticated;
grant execute on function public.reconcile_attendance_date(date,uuid),public.reconcile_attendance_month(uuid,date)
 to postgres,service_role;

-- Explicitly revoke direct Supabase role grants as well as PUBLIC defaults.
-- Owner-executed business functions/cron and trigger dispatch retain access.
revoke all on function public.assert_admin(),public.month_is_closed(uuid,date),
 public.day_context(public.employees,date),public.leave_working_days(public.employees,date,date,public.leave_portion),
 public.on_employee_password_changed(),public.crm_invoice_guard(),public.crm_require_onboarded(),public.crm_queue_reminders()
 from public,anon,authenticated;
grant execute on function public.crm_queue_reminders() to postgres,service_role;
