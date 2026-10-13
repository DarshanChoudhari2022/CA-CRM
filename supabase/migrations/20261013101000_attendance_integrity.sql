-- All attendance/leave writers acquire month locks before employee/request locks.
create function public.lock_attendance_range(p_org uuid,p_start date,p_end date)
returns void language plpgsql security definer set search_path=public as $$
declare m date;
begin
 if p_org is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Invalid attendance date range'; end if;
 for m in select generate_series(date_trunc('month',p_start),date_trunc('month',p_end),'1 month')::date loop
  insert into public.attendance_months(organization_id,month_start) values(p_org,m) on conflict do nothing;
  perform 1 from public.attendance_months where organization_id=p_org and month_start=m for update;
  if public.month_is_closed(p_org,m) then raise exception 'MONTH_LOCKED: Reopen the month before making changes.'; end if;
 end loop;
end $$;
revoke all on function public.lock_attendance_range(uuid,date,date) from public,anon,authenticated;

alter function public.record_attendance_punch(text,uuid) rename to record_attendance_punch_core;
revoke all on function public.record_attendance_punch_core(text,uuid) from public,anon,authenticated;
create function public.record_attendance_punch(p_kind text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare e uuid:=public.current_employee_id(); org uuid:=public.current_organization_id(); d date;
begin
 if e is null or org is null then raise exception 'Active employee access required'; end if;
 d:=(now() at time zone (select timezone from public.organizations where id=org))::date;
 perform public.lock_attendance_range(org,d,d);
 perform pg_advisory_xact_lock(hashtextextended(e::text||':attendance-leave',0));
 if exists(select 1 from public.leave_requests where employee_id=e and state='approved' and portion='full_day' and d between start_date and end_date) then raise exception 'Approved full-day leave prevents punching on this date'; end if;
 return public.record_attendance_punch_core(p_kind,p_request_id);
end $$;

alter function public.request_attendance_correction(date,time,time,text,uuid) rename to request_attendance_correction_core;
revoke all on function public.request_attendance_correction_core(date,time,time,text,uuid) from public,anon,authenticated;
create function public.request_attendance_correction(p_work_date date,p_check_in time,p_check_out time,p_reason text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; org uuid:=public.current_organization_id(); zone text;
begin
 select * into e from public.employees where id=public.current_employee_id() and organization_id=org and active;
 if e.id is null then raise exception 'Active employee access required'; end if;
 select timezone into zone from public.organizations where id=org;
 if p_work_date is null or p_check_in is null or p_check_out is null or public.day_context(e,p_work_date)='outside_employment'
 or ((p_work_date+p_check_out) at time zone zone)>now() then raise exception 'Correction must be within employment and cannot include future times'; end if;
 perform public.lock_attendance_range(org,p_work_date,p_work_date);
 perform pg_advisory_xact_lock(hashtextextended(e.id::text||':attendance-leave',0));
 if exists(select 1 from public.leave_requests where employee_id=e.id and state='approved' and portion='full_day' and p_work_date between start_date and end_date) then raise exception 'Approved full-day leave conflicts with this correction'; end if;
 return public.request_attendance_correction_core(p_work_date,p_check_in,p_check_out,p_reason,p_request_id);
end $$;

alter function public.submit_leave_request(uuid,date,date,public.leave_portion,text,uuid) rename to submit_leave_request_core;
revoke all on function public.submit_leave_request_core(uuid,date,date,public.leave_portion,text,uuid) from public,anon,authenticated;
create function public.submit_leave_request(p_leave_type_id uuid,p_start_date date,p_end_date date,p_portion public.leave_portion,p_reason text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; org uuid:=public.current_organization_id();
begin
 select * into e from public.employees where id=public.current_employee_id() and organization_id=org and active;
 if e.id is null then raise exception 'Active employee access required'; end if;
 if p_start_date is null or p_end_date is null or extract(year from p_start_date)<>extract(year from p_end_date) then raise exception 'Submit separate leave requests for each calendar year'; end if;
 if p_start_date<e.joined_on or (e.last_working_on is not null and p_end_date>e.last_working_on) then raise exception 'Leave must be within employment dates'; end if;
 perform public.lock_attendance_range(org,p_start_date,p_end_date);
 perform pg_advisory_xact_lock(hashtextextended(e.id::text||':attendance-leave',0));
 insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated)
 select org,e.id,id,extract(year from p_start_date),default_days from public.leave_types where id=p_leave_type_id and organization_id=org and active
 on conflict(employee_id,leave_type_id,year) do nothing;
 if p_portion='full_day' and exists(select 1 from public.attendance_days where employee_id=e.id and work_date between p_start_date and p_end_date and check_in_at is not null) then raise exception 'Recorded attendance conflicts with full-day leave'; end if;
 return public.submit_leave_request_core(p_leave_type_id,p_start_date,p_end_date,p_portion,p_reason,p_request_id);
end $$;

alter function public.decide_leave_request(uuid,text,text,uuid) rename to decide_leave_request_core;
revoke all on function public.decide_leave_request_core(uuid,text,text,uuid) from public,anon,authenticated;
create function public.decide_leave_request(p_id uuid,p_decision text,p_reason text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare r public.leave_requests; e public.employees;
begin
 select * into r from public.leave_requests where id=p_id and organization_id=public.current_organization_id();
 if r.id is null or not public.is_reviewer_for(r.employee_id) then raise exception 'Request unavailable'; end if;
 perform public.lock_attendance_range(r.organization_id,r.start_date,r.end_date);
 perform pg_advisory_xact_lock(hashtextextended(r.employee_id::text||':attendance-leave',0));
 if p_decision='approved' then
  select * into e from public.employees where id=r.employee_id;
  if not e.active or r.start_date<e.joined_on or (e.last_working_on is not null and r.end_date>e.last_working_on)
   or public.leave_working_days(e,r.start_date,r.end_date,r.portion)<>r.requested_days then raise exception 'Employment or calendar changed; reject and resubmit the request'; end if;
  if r.portion='full_day' and (exists(select 1 from public.attendance_days where employee_id=r.employee_id and work_date between r.start_date and r.end_date and check_in_at is not null)
   or exists(select 1 from public.attendance_corrections where employee_id=r.employee_id and work_date between r.start_date and r.end_date and state='pending')) then raise exception 'Attendance or a pending correction conflicts with full-day leave'; end if;
 end if;
 perform public.decide_leave_request_core(p_id,p_decision,p_reason,p_request_id);
end $$;

create or replace function public.decide_attendance_correction(p_id uuid,p_decision text,p_reason text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare r public.attendance_corrections; d public.attendance_days; p public.attendance_policies; e public.employees; minutes int; zone text;
begin
 if p_decision is null or p_decision not in ('approved','rejected') or p_request_id is null then raise exception 'Invalid decision'; end if;
 select * into r from public.attendance_corrections where id=p_id and organization_id=public.current_organization_id();
 if r.id is null or not public.is_reviewer_for(r.employee_id) then raise exception 'Correction unavailable'; end if;
 perform public.lock_attendance_range(r.organization_id,r.work_date,r.work_date);
 perform pg_advisory_xact_lock(hashtextextended(r.employee_id::text||':attendance-leave',0));
 select * into r from public.attendance_corrections where id=p_id for update;
 if r.state<>'pending' then raise exception 'Correction is already decided'; end if;
 if p_decision='rejected' and (p_reason is null or length(trim(p_reason)) not between 3 and 500) then raise exception 'Rejection reason required'; end if;
 if p_decision='approved' then
  select * into e from public.employees where id=r.employee_id;
  if not e.active or public.day_context(e,r.work_date)='outside_employment' or r.proposed_check_out>now() then raise exception 'Correction is outside employment or contains future times'; end if;
  if exists(select 1 from public.leave_requests where employee_id=r.employee_id and state='approved' and portion='full_day' and r.work_date between start_date and end_date) then raise exception 'Full-day leave conflicts with correction'; end if;
  select * into d from public.attendance_days where employee_id=r.employee_id and work_date=r.work_date for update;
  if d.id is null or d.revision<>r.base_revision then raise exception 'Attendance changed; reject the stale correction and resubmit'; end if;
  select * into p from public.attendance_policies where id=d.policy_id;
  select timezone into zone from public.organizations where id=r.organization_id;
  minutes:=floor(extract(epoch from (r.proposed_check_out-r.proposed_check_in))/60);
  update public.attendance_days set check_in_at=r.proposed_check_in,check_out_at=r.proposed_check_out,duration_minutes=minutes,
   result=case when calendar_context<>'working_day' then 'not_applicable'::public.attendance_result when minutes>=p.full_day_minutes then 'full_day'::public.attendance_result when minutes>=p.half_day_minutes then 'half_day'::public.attendance_result else 'short_day'::public.attendance_result end,
   is_late=(calendar_context='working_day' and (r.proposed_check_in at time zone zone)::time>p.shift_start+make_interval(mins=>p.grace_minutes)),
   is_early_departure=(calendar_context='working_day' and (r.proposed_check_out at time zone zone)::time<p.shift_end),revision=revision+1,updated_at=now() where id=d.id;
 end if;
 update public.attendance_corrections set state=p_decision::public.request_state,reviewed_by=auth.uid(),reviewed_at=now(),decision_reason=nullif(trim(p_reason),'') where id=p_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(r.organization_id,auth.uid(),'correction_'||p_decision,'attendance_correction',r.id::text,p_request_id);
end $$;

alter function public.close_attendance_month(text,uuid) rename to close_attendance_month_core;
revoke all on function public.close_attendance_month_core(text,uuid) from public,anon,authenticated;
create function public.close_attendance_month(p_month text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); m date;
begin
 perform public.assert_admin();
 if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month'; end if;
 m:=(p_month||'-01')::date;
 perform public.lock_attendance_range(org,m,m);
 if exists(select 1 from public.leave_requests where organization_id=org and state='pending' and start_date<m+interval '1 month' and end_date>=m) then raise exception 'Resolve pending leave requests before closing the month'; end if;
 perform public.close_attendance_month_core(p_month,p_request_id);
end $$;

create or replace function public.attendance_month_summary(p_month text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
 with scope as (select e.* from public.employees e where e.organization_id=public.current_organization_id() and public.can_view_employee(e.id)),
 bounds as (select (p_month||'-01')::date first_day,((p_month||'-01')::date+interval '1 month')::date next_month),
 days as (select d.* from public.attendance_days d join scope e on e.id=d.employee_id cross join bounds b where d.work_date>=b.first_day and d.work_date<b.next_month)
 select jsonb_build_object('expectedDays',count(*) filter(where calendar_context='working_day'),
  'fullDays',count(*) filter(where result='full_day'),'halfDays',count(*) filter(where result='half_day'),'shortDays',count(*) filter(where result='short_day'),
  'absentDays',count(*) filter(where result='absent'),
  'leaveDays',(select coalesce(sum(public.leave_working_days(e,greatest(r.start_date,b.first_day),least(r.end_date,b.next_month-1),r.portion)),0) from public.leave_requests r join scope e on e.id=r.employee_id cross join bounds b where r.state='approved' and r.start_date<b.next_month and r.end_date>=b.first_day),
  'incompleteDays',count(*) filter(where check_in_at is not null and check_out_at is null),
  'totalHours',(coalesce(sum(duration_minutes),0)/60)||'h',
  'isClosed',public.month_is_closed(public.current_organization_id(),(p_month||'-01')::date),
  'blockers',count(*) filter(where check_in_at is not null and check_out_at is null)
    +(select count(*) from public.attendance_corrections r join scope e on e.id=r.employee_id cross join bounds b where r.state='pending' and r.work_date>=b.first_day and r.work_date<b.next_month)
    +(select count(*) from public.leave_requests r join scope e on e.id=r.employee_id cross join bounds b where r.state='pending' and r.start_date<b.next_month and r.end_date>=b.first_day)) from days;
$$;

revoke all on function public.record_attendance_punch(text,uuid),public.request_attendance_correction(date,time,time,text,uuid),public.submit_leave_request(uuid,date,date,public.leave_portion,text,uuid),public.decide_leave_request(uuid,text,text,uuid),public.decide_attendance_correction(uuid,text,text,uuid),public.close_attendance_month(text,uuid) from public,anon;
grant execute on function public.record_attendance_punch(text,uuid),public.request_attendance_correction(date,time,time,text,uuid),public.submit_leave_request(uuid,date,date,public.leave_portion,text,uuid),public.decide_leave_request(uuid,text,text,uuid),public.decide_attendance_correction(uuid,text,text,uuid),public.close_attendance_month(text,uuid) to authenticated;
