-- Use the organization's business date at year/day boundaries, not the database server's UTC date.
create or replace function public.submit_leave_request(p_leave_type_id uuid,p_start_date date,p_end_date date,p_portion public.leave_portion,p_reason text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; org uuid:=public.current_organization_id(); today date;
begin
 select * into e from public.employees where id=public.current_employee_id() and organization_id=org and active;
 if e.id is null then raise exception 'Active employee access required'; end if;
 select (now() at time zone timezone)::date into today from public.organizations where id=org;
 if p_start_date is null or p_end_date is null or p_start_date<today then raise exception 'Choose a current or future business date'; end if;
 if extract(year from p_start_date)<>extract(year from p_end_date) then raise exception 'Submit separate leave requests for each calendar year'; end if;
 if p_start_date<e.joined_on or (e.last_working_on is not null and p_end_date>e.last_working_on) then raise exception 'Leave must be within employment dates'; end if;
 perform public.lock_attendance_range(org,p_start_date,p_end_date);
 perform pg_advisory_xact_lock(hashtextextended(e.id::text||':attendance-leave',0));
 insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated)
 select org,e.id,id,extract(year from p_start_date),default_days from public.leave_types where id=p_leave_type_id and organization_id=org and active
 on conflict(employee_id,leave_type_id,year) do nothing;
 if p_portion='full_day' and exists(select 1 from public.attendance_days where employee_id=e.id and work_date between p_start_date and p_end_date and check_in_at is not null) then raise exception 'Recorded attendance conflicts with full-day leave'; end if;
 return public.submit_leave_request_core(p_leave_type_id,p_start_date,p_end_date,p_portion,p_reason,p_request_id);
end $$;
create or replace function public.my_leave_snapshot()
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select jsonb_build_object(
 'types',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'allocated',coalesce(b.allocated,t.default_days),'used',coalesce(b.used,0),'available',coalesce(b.allocated,t.default_days)-coalesce(b.used,0)) order by t.name)
 from public.leave_types t join public.organizations o on o.id=t.organization_id
 left join public.leave_balances b on b.leave_type_id=t.id and b.employee_id=public.current_employee_id() and b.year=extract(year from (now() at time zone o.timezone)::date)
 where t.organization_id=public.current_organization_id() and t.active and public.current_employee_id() is not null),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'type',t.name,'dates',to_char(r.start_date,'DD Mon')||case when r.end_date<>r.start_date then ' – '||to_char(r.end_date,'DD Mon') else '' end,'days',r.requested_days,'state',r.state,'submittedAt',r.requested_at) order by r.requested_at desc)
 from public.leave_requests r join public.leave_types t on t.id=r.leave_type_id where r.employee_id=public.current_employee_id()),'[]'::jsonb));
$$;
revoke all on function public.my_leave_snapshot() from public,anon;
grant execute on function public.my_leave_snapshot() to authenticated;
