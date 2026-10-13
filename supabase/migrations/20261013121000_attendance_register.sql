create function public.attendance_register(p_date date,p_branch uuid default null,p_department text default '',p_search text default '',p_result text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); today date; result jsonb;
begin
 if not public.has_portal_role(array['manager','admin','partner']::public.portal_role[]) then raise exception 'Manager or administrator access required'; end if;
 select (now() at time zone timezone)::date into today from public.organizations where id=org;
 if p_date is null or p_date>today or p_page is null or p_page not between 1 and 100000 then raise exception 'Choose a current or past date and valid page'; end if;
 with employees as (
  select e.*,b.name branch,public.day_context(e,p_date) context from public.employees e join public.branches b on b.id=e.branch_id
  where e.organization_id=org and public.can_view_employee(e.id) and (e.active or p_date<today)
   and e.joined_on<=p_date and (e.last_working_on is null or e.last_working_on>=p_date)
   and (p_branch is null or e.branch_id=p_branch) and (coalesce(p_department,'')='' or e.department=p_department)
   and (coalesce(p_search,'')='' or position(lower(p_search) in lower(e.full_name||' '||e.employee_code))>0)
 ), rows as (
  select e.id employee_id,e.employee_code,e.full_name,e.department,e.branch,e.context,d.check_in_at,d.check_out_at,d.duration_minutes,coalesce(d.is_late,false) is_late,
   case when d.check_in_at is not null and d.check_out_at is null then case when p_date<today then 'incomplete' else 'open' end
    when d.result is not null then d.result::text
    when e.context<>'working_day' then 'not_applicable'
    when exists(select 1 from public.leave_requests l where l.employee_id=e.id and l.state='approved' and l.portion='full_day' and p_date between l.start_date and l.end_date) then 'excused'
    when p_date=today then 'not_started' else 'absent' end result
  from employees e left join public.attendance_days d on d.employee_id=e.id and d.work_date=p_date
 ), filtered as (select * from rows r where coalesce(p_result,'')='' or r.result=p_result), paged as (
  select * from filtered order by full_name,employee_id limit 50 offset (p_page-1)*50
 )
 select jsonb_build_object('date',p_date,'page',p_page,'total',(select count(*) from filtered),
 'items',coalesce((select jsonb_agg(to_jsonb(paged) order by full_name,employee_id) from paged),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.attendance_register(date,uuid,text,text,text,integer) from public,anon;
grant execute on function public.attendance_register(date,uuid,text,text,text,integer) to authenticated;

-- Derive missing/historical days on read so a delayed job cannot hide absence or incomplete shifts.
create or replace function public.my_attendance_history(p_month text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare e public.employees; zone text; today date; start_date date; last_date date; result jsonb;
begin
 select * into e from public.employees where id=public.current_employee_id();
 if e.id is null then raise exception 'Active employee access required'; end if;
 if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month'; end if;
 select timezone into zone from public.organizations where id=e.organization_id;
 today:=(now() at time zone zone)::date;
 start_date:=greatest((p_month||'-01')::date,e.joined_on);
 last_date:=least(((p_month||'-01')::date+interval '1 month'-interval '1 day')::date,today,coalesce(e.last_working_on,today));
 with dates as (select generate_series(start_date,last_date,'1 day')::date as calendar_date), records as (
  select dates.calendar_date,public.day_context(e,dates.calendar_date) context,d.* from dates left join public.attendance_days d on d.employee_id=e.id and d.work_date=dates.calendar_date
 )
 select coalesce(jsonb_agg(jsonb_build_object('date',to_char(r.calendar_date,'DD Mon YYYY'),'context',r.context,
  'checkIn',to_char(r.check_in_at at time zone zone,'HH12:MI AM'),'checkOut',to_char(r.check_out_at at time zone zone,'HH12:MI AM'),
  'duration',case when r.duration_minutes is null then '—' else (r.duration_minutes/60)||'h '||(r.duration_minutes%60)||'m' end,
  'result',case when r.check_in_at is not null and r.check_out_at is null then case when r.calendar_date<today then 'incomplete' else 'open' end
   when r.result is not null then r.result::text when r.context<>'working_day' then 'not_applicable'
   when exists(select 1 from public.leave_requests l where l.employee_id=e.id and l.state='approved' and l.portion='full_day' and r.calendar_date between l.start_date and l.end_date) then 'excused'
   when r.calendar_date=today then 'not_started' else 'absent' end,
  'isLate',coalesce(r.is_late,false),'correctionStatus',(select c.state::text from public.attendance_corrections c where c.employee_id=e.id and c.work_date=r.calendar_date order by c.requested_at desc limit 1)) order by r.calendar_date desc),'[]'::jsonb) into result from records r;
 return result;
end $$;

create or replace function public.pending_approvals()
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select coalesce(jsonb_agg(item order by submitted_at),'[]'::jsonb) from (
  select l.requested_at submitted_at,jsonb_build_object('id',l.id,'kind','leave','employee',e.full_name,
   'summary',t.name||': '||to_char(l.start_date,'DD Mon')||' – '||to_char(l.end_date,'DD Mon')||' ('||l.requested_days||' days)',
   'reason',l.reason,'submittedAt',l.requested_at) item
  from public.leave_requests l join public.employees e on e.id=l.employee_id join public.leave_types t on t.id=l.leave_type_id
  where l.organization_id=public.current_organization_id() and l.state='pending' and public.is_reviewer_for(l.employee_id)
  union all
  select c.requested_at,jsonb_build_object('id',c.id,'kind','attendance','employee',e.full_name,
   'summary',to_char(c.work_date,'DD Mon YYYY'),'reason',c.reason,'submittedAt',c.requested_at,
   'originalIn',to_char(d.check_in_at at time zone o.timezone,'HH12:MI AM'),'originalOut',to_char(d.check_out_at at time zone o.timezone,'HH12:MI AM'),
   'proposedIn',to_char(c.proposed_check_in at time zone o.timezone,'HH12:MI AM'),'proposedOut',to_char(c.proposed_check_out at time zone o.timezone,'HH12:MI AM'),
   'isStale',d.revision is distinct from c.base_revision)
  from public.attendance_corrections c join public.employees e on e.id=c.employee_id join public.organizations o on o.id=c.organization_id
  left join public.attendance_days d on d.employee_id=c.employee_id and d.work_date=c.work_date
  where c.organization_id=public.current_organization_id() and c.state='pending' and public.is_reviewer_for(c.employee_id)
 ) pending;
$$;
revoke all on function public.pending_approvals(),public.my_attendance_history(text) from public,anon;
grant execute on function public.pending_approvals(),public.my_attendance_history(text) to authenticated;
