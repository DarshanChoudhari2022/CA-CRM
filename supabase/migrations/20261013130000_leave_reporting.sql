-- Display leave distinctly without changing persisted excused annotations or immutable snapshots.
create index if not exists leave_requests_approved_calendar on public.leave_requests(employee_id,start_date,end_date) where state='approved';
create function public.attendance_result_label(p_employee uuid,p_date date,p_context text,p_in timestamptz,p_out timestamptz,p_result text)
returns text language sql stable security definer set search_path=public as $$
 select case
 when p_context='working_day' and exists(select 1 from public.leave_requests where employee_id=p_employee and state='approved' and portion='full_day' and p_date between start_date and end_date) then 'leave_approved'
 when p_in is null and p_context='working_day' and exists(select 1 from public.leave_requests where employee_id=p_employee and state='approved' and portion<>'full_day' and p_date between start_date and end_date) then 'half_day_leave_approved'
 when p_in is not null and p_out is null then case when p_date<(now() at time zone (select timezone from public.organizations where id=public.current_organization_id()))::date then 'incomplete' else 'open' end
 when p_result is not null then p_result
 when p_context<>'working_day' then 'not_applicable'
 when p_date=(now() at time zone (select timezone from public.organizations where id=public.current_organization_id()))::date then 'not_started' else 'absent' end;
$$;
revoke all on function public.attendance_result_label(uuid,date,text,timestamptz,timestamptz,text) from public,anon,authenticated;

-- Single role-scoped calendar source for live summaries, employee totals and exports.
create function public.attendance_month_rows(p_month text)
returns table(employee_id uuid,employee_code text,employee_name text,department text,work_date date,context text,check_in timestamptz,check_out timestamptz,duration_minutes integer,result text,late boolean,early_departure boolean,leave_days numeric)
language plpgsql stable security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); today date; first_day date; last_day date;
begin
 if org is null or p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid report month or access'; end if;
 select (now() at time zone timezone)::date into today from public.organizations where id=org;
 first_day:=(p_month||'-01')::date; last_day:=least((first_day+interval '1 month'-interval '1 day')::date,today);
 return query
 with scope as (
  select e.* from public.employees e where e.organization_id=org and public.can_view_employee(e.id)
   and not exists(select 1 from public.profiles p where p.user_id=e.profile_user_id and p.role in ('admin','partner'))
 ), dates as (
  select e.*,g::date calendar_date,public.day_context(e,g::date) day_context from scope e
  cross join lateral generate_series(greatest(first_day,e.joined_on),least(last_day,coalesce(e.last_working_on,last_day)),'1 day') g
 ), rows as (
  select e.*,d.check_in_at,d.check_out_at,d.duration_minutes minutes,d.result saved_result,d.is_late,d.is_early_departure,
   case when e.day_context='working_day' then coalesce((select max(case when l.portion='full_day' then 1::numeric else 0.5 end) from public.leave_requests l where l.employee_id=e.id and l.state='approved' and e.calendar_date between l.start_date and l.end_date),0) else 0 end approved_leave
  from dates e left join public.attendance_days d on d.employee_id=e.id and d.work_date=e.calendar_date
 )
 select r.id,r.employee_code,r.full_name,r.department,r.calendar_date,r.day_context,r.check_in_at,r.check_out_at,r.minutes,
 public.attendance_result_label(r.id,r.calendar_date,r.day_context,r.check_in_at,r.check_out_at,r.saved_result::text),coalesce(r.is_late,false),coalesce(r.is_early_departure,false),r.approved_leave from rows r;
end $$;
revoke all on function public.attendance_month_rows(text) from public,anon,authenticated;

create or replace function public.attendance_month_summary(p_month text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
 with rows as (select * from public.attendance_month_rows(p_month)), bounds as (select (p_month||'-01')::date first_day,((p_month||'-01')::date+interval '1 month')::date next_month),
 scope as (select e.* from public.employees e where e.organization_id=public.current_organization_id() and public.can_view_employee(e.id) and not exists(select 1 from public.profiles p where p.user_id=e.profile_user_id and p.role in ('admin','partner')))
 select jsonb_build_object('expectedDays',count(*) filter(where context='working_day'),
 'fullDays',count(*) filter(where result='full_day'),'halfDays',count(*) filter(where result='half_day'),'shortDays',count(*) filter(where result='short_day'),
 'absentDays',coalesce(sum(case when result='absent' then 1 when result='half_day_leave_approved' and work_date<(now() at time zone (select timezone from public.organizations where id=public.current_organization_id()))::date then 0.5 else 0 end),0),
 'leaveDays',coalesce(sum(leave_days),0),
 'approvedLeaveDays',(select coalesce(sum(public.leave_working_days(e,greatest(l.start_date,b.first_day),least(l.end_date,b.next_month-1),l.portion)),0) from public.leave_requests l join scope e on e.id=l.employee_id cross join bounds b where l.state='approved' and l.start_date<b.next_month and l.end_date>=b.first_day),
 'incompleteDays',count(*) filter(where check_in is not null and check_out is null),
 'totalHours',(coalesce(sum(duration_minutes),0)/60)||'h '||(coalesce(sum(duration_minutes),0)%60)||'m',
 'isClosed',public.month_is_closed(public.current_organization_id(),(p_month||'-01')::date),
 'blockers',count(*) filter(where check_in is not null and check_out is null)
 +(select count(*) from public.attendance_corrections c join scope e on e.id=c.employee_id cross join bounds b where c.state='pending' and c.work_date>=b.first_day and c.work_date<b.next_month)
 +(select count(*) from public.leave_requests l join scope e on e.id=l.employee_id cross join bounds b where l.state='pending' and l.start_date<b.next_month and l.end_date>=b.first_day)) from rows;
$$;

create function public.attendance_month_employee_totals(p_month text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_result jsonb;
begin
 perform public.assert_admin();
 with rows as (select * from public.attendance_month_rows(p_month)), totals as (
  select employee_id,employee_code,employee_name,department,
  count(*) filter(where context='working_day') "expectedDays",count(*) filter(where check_in is not null) "presentDays",
  coalesce(sum(leave_days),0) "leaveDays",
  coalesce(sum(case when result='absent' then 1 when result='half_day_leave_approved' and work_date<(now() at time zone (select timezone from public.organizations where id=public.current_organization_id()))::date then 0.5 else 0 end),0) "absentDays",
  count(*) filter(where check_in is not null and check_out is null) "incompleteDays",coalesce(sum(duration_minutes),0) "durationMinutes"
  from rows group by employee_id,employee_code,employee_name,department
 ) select coalesce(jsonb_agg(to_jsonb(totals)||jsonb_build_object('approvedLeaveDays',
  (select coalesce(sum(public.leave_working_days(e,greatest(l.start_date,(p_month||'-01')::date),least(l.end_date,((p_month||'-01')::date+interval '1 month'-interval '1 day')::date),l.portion)),0)
   from public.leave_requests l join public.employees e on e.id=l.employee_id where l.employee_id=totals.employee_id and l.state='approved' and l.start_date<((p_month||'-01')::date+interval '1 month') and l.end_date>=(p_month||'-01')::date)) order by employee_name,employee_id),'[]'::jsonb) into v_result from totals;
 return v_result;
end $$;

create function public.admin_attendance_overview()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); today date; result jsonb;
begin
 perform public.assert_admin();
 select (now() at time zone timezone)::date into today from public.organizations where id=org;
 with scope as (select e.* from public.employees e where e.organization_id=org and e.active and e.joined_on<=today and (e.last_working_on is null or e.last_working_on>=today)
  and not exists(select 1 from public.profiles p where p.user_id=e.profile_user_id and p.role in ('admin','partner'))),
 leaves as (select e.full_name employee,t.name "leaveType",l.portion,l.start_date "startDate",l.end_date "endDate" from public.leave_requests l join scope e on e.id=l.employee_id join public.leave_types t on t.id=l.leave_type_id where l.state='approved' and today between l.start_date and l.end_date and public.day_context(e,today)='working_day')
 select jsonb_build_object('date',today,'expected',(select count(*) from scope e where public.day_context(e,today)='working_day'),
 'present',(select count(*) from scope e join public.attendance_days d on d.employee_id=e.id and d.work_date=today where d.check_in_at is not null),
 'onLeave',(select count(*) from leaves),'pendingApprovals',public.pending_approval_count(),
 'leaves',coalesce((select jsonb_agg(to_jsonb(leaves) order by employee) from leaves),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_attendance_overview() from public,anon;
grant execute on function public.admin_attendance_overview() to authenticated;

create or replace function public.dashboard_snapshot_v2()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare snapshot jsonb; minutes integer; e public.employees; zone text; today date; recent jsonb; balances jsonb;
begin
 snapshot:=public.dashboard_snapshot();
 select * into e from public.employees where id=public.current_employee_id();
 select timezone into zone from public.organizations where id=e.organization_id; today:=(now() at time zone zone)::date;
 minutes:=case when snapshot#>>'{today,checkIn}' is null then 0 else greatest(0,floor(extract(epoch from(coalesce((snapshot#>>'{today,checkOut}')::timestamptz,now())-(snapshot#>>'{today,checkIn}')::timestamptz))/60)::integer) end;
 snapshot:=jsonb_set(snapshot,'{today}',(snapshot->'today')||jsonb_build_object('serverNow',now(),'durationMinutes',minutes));
 if exists(select 1 from public.leave_requests where employee_id=e.id and state='approved' and portion='full_day' and today between start_date and end_date) and public.day_context(e,today)='working_day' then
  snapshot:=jsonb_set(snapshot,'{today}',(snapshot->'today')||jsonb_build_object('state','leave_approved','canCheckIn',false,'canCheckOut',false));
 end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into recent from (select value item from jsonb_array_elements(public.my_attendance_history(to_char(today,'YYYY-MM'))) with ordinality order by ordinality limit 5) r;
 balances:=public.my_leave_snapshot()->'types';
 return snapshot||jsonb_build_object('recent',recent,'leaveBalances',balances);
end $$;
revoke all on function public.attendance_month_employee_totals(text) from public,anon;
grant execute on function public.attendance_month_employee_totals(text) to authenticated;

create or replace function public.attendance_export_rows(p_month text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select coalesce(jsonb_agg(jsonb_build_object('employeeId',r.employee_id,'employeeCode',r.employee_code,'employeeName',r.employee_name,'department',r.department,'workDate',r.work_date,
 'context',r.context,'checkIn',to_char(r.check_in at time zone o.timezone,'YYYY-MM-DD HH24:MI'),'checkOut',to_char(r.check_out at time zone o.timezone,'YYYY-MM-DD HH24:MI'),
 'durationMinutes',r.duration_minutes,'result',r.result,'late',r.late,'earlyDeparture',r.early_departure,'leaveDays',r.leave_days) order by r.employee_name,r.work_date),'[]'::jsonb)
 from public.attendance_month_rows(p_month) r join public.organizations o on o.id=public.current_organization_id();
$$;

create function public.leave_approval_history(p_month text,p_state text default 'approved',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare result jsonb; first_day date; last_day date;
begin
 if not public.has_portal_role(array['manager','admin','partner']::public.portal_role[]) then raise exception 'Reviewer access required'; end if;
 if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_state not in ('approved','rejected','all') or p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid history filters'; end if;
 first_day:=(p_month||'-01')::date; last_day:=(first_day+interval '1 month')::date;
 with history as (
  select l.id,e.full_name employee,e.employee_code,t.name "leaveType",l.start_date "startDate",l.end_date "endDate",l.requested_days days,l.portion,l.reason,l.state,l.reviewed_at "reviewedAt",p.full_name "reviewedBy",l.decision_reason "decisionReason"
  from public.leave_requests l join public.employees e on e.id=l.employee_id join public.leave_types t on t.id=l.leave_type_id left join public.profiles p on p.user_id=l.reviewed_by
  where l.organization_id=public.current_organization_id() and public.is_reviewer_for(l.employee_id) and l.state in ('approved','rejected') and (p_state='all' or l.state::text=p_state)
   and l.start_date<last_day and l.end_date>=first_day
 ), paged as (select * from history order by "reviewedAt" desc nulls last,id limit 50 offset (p_page-1)*50)
 select jsonb_build_object('total',(select count(*) from history),'items',coalesce((select jsonb_agg(to_jsonb(paged) order by "reviewedAt" desc nulls last,id) from paged),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.leave_approval_history(text,text,integer) from public,anon;
grant execute on function public.leave_approval_history(text,text,integer) to authenticated;

create or replace function public.my_attendance_history(p_month text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare e public.employees; zone text; today date; first_day date; last_day date; result jsonb;
begin
 select * into e from public.employees where id=public.current_employee_id();
 if e.id is null then raise exception 'Active employee access required'; end if;
 if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month'; end if;
 select timezone into zone from public.organizations where id=e.organization_id;
 today:=(now() at time zone zone)::date; first_day:=greatest((p_month||'-01')::date,e.joined_on);
 last_day:=least(((p_month||'-01')::date+interval '1 month'-interval '1 day')::date,today,coalesce(e.last_working_on,today));
 with dates as (select generate_series(first_day,last_day,'1 day')::date calendar_date), records as (
  select dates.calendar_date,public.day_context(e,dates.calendar_date) context,d.* from dates left join public.attendance_days d on d.employee_id=e.id and d.work_date=dates.calendar_date
 ) select coalesce(jsonb_agg(jsonb_build_object('date',to_char(r.calendar_date,'DD Mon YYYY'),'context',r.context,
 'checkIn',to_char(r.check_in_at at time zone zone,'HH12:MI AM'),'checkOut',to_char(r.check_out_at at time zone zone,'HH12:MI AM'),
 'duration',case when r.duration_minutes is null then '—' else (r.duration_minutes/60)||'h '||(r.duration_minutes%60)||'m' end,
 'result',public.attendance_result_label(e.id,r.calendar_date,r.context,r.check_in_at,r.check_out_at,r.result::text),
 'isLate',coalesce(r.is_late,false),'correctionStatus',(select c.state::text from public.attendance_corrections c where c.employee_id=e.id and c.work_date=r.calendar_date order by c.requested_at desc limit 1)) order by r.calendar_date desc),'[]'::jsonb) into result from records r;
 return result;
end $$;

create or replace function public.attendance_register(p_date date,p_branch uuid default null,p_department text default '',p_search text default '',p_result text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); today date; result jsonb;
begin
 if not public.has_portal_role(array['manager','admin','partner']::public.portal_role[]) then raise exception 'Manager or administrator access required'; end if;
 select (now() at time zone timezone)::date into today from public.organizations where id=org;
 if p_date is null or p_date>today or p_page is null or p_page not between 1 and 100000 then raise exception 'Choose a current or past date and valid page'; end if;
 with employees as (
  select e.*,b.name branch,public.day_context(e,p_date) context from public.employees e join public.branches b on b.id=e.branch_id
  where e.organization_id=org and public.can_view_employee(e.id) and (e.active or p_date<today)
   and not exists(select 1 from public.profiles p where p.user_id=e.profile_user_id and p.role in ('admin','partner'))
   and e.joined_on<=p_date and (e.last_working_on is null or e.last_working_on>=p_date)
   and (p_branch is null or e.branch_id=p_branch) and (coalesce(p_department,'')='' or e.department=p_department)
   and (coalesce(p_search,'')='' or position(lower(p_search) in lower(e.full_name||' '||e.employee_code))>0)
 ), rows as (
  select e.id employee_id,e.employee_code,e.full_name,e.department,e.branch,e.context,d.check_in_at,d.check_out_at,d.duration_minutes,coalesce(d.is_late,false) is_late,
   public.attendance_result_label(e.id,p_date,e.context,d.check_in_at,d.check_out_at,d.result::text) result
  from employees e left join public.attendance_days d on d.employee_id=e.id and d.work_date=p_date
 ), filtered as (select * from rows r where coalesce(p_result,'')='' or r.result=p_result), paged as (select * from filtered order by full_name,employee_id limit 50 offset (p_page-1)*50)
 select jsonb_build_object('date',p_date,'page',p_page,'total',(select count(*) from filtered),'items',coalesce((select jsonb_agg(to_jsonb(paged) order by full_name,employee_id) from paged),'[]'::jsonb)) into result;
 return result;
end $$;
