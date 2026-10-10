alter table public.attendance_days add column excuse_reason text;

create or replace function public.admin_excuse_day(p_employee uuid,p_date date,p_reason text,p_remove boolean)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; d public.attendance_days; org uuid:=public.current_organization_id(); request uuid:=gen_random_uuid();
begin
 perform public.assert_admin();
 if p_employee=public.current_employee_id() then raise exception 'Non-self administrator required'; end if;
 insert into public.attendance_months(organization_id,month_start) values(org,date_trunc('month',p_date)::date) on conflict do nothing;
 perform 1 from public.attendance_months where organization_id=org and month_start=date_trunc('month',p_date)::date for update;
 if public.month_is_closed(org,p_date) then raise exception 'Month is closed'; end if;
 select * into e from public.employees where id=p_employee and organization_id=org for update;
 if e.id is null or p_date is null or p_date>=(now() at time zone 'Asia/Kolkata')::date or public.day_context(e,p_date)<>'working_day' or length(trim(p_reason)) not between 10 and 500 then raise exception 'Choose a past working day and a reason of 10–500 characters'; end if;
 insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context) values(org,e.id,p_date,e.branch_id,e.policy_id,'working_day') on conflict do nothing;
 select * into d from public.attendance_days where employee_id=e.id and work_date=p_date for update;
 if d.check_in_at is not null or d.check_out_at is not null or exists(select 1 from public.attendance_corrections where employee_id=e.id and work_date=p_date and state='pending') then raise exception 'Punches or a pending correction prevent annotation'; end if;
 update public.attendance_days set excuse_reason=case when p_remove then null else trim(p_reason) end,
 result=case when not p_remove or exists(select 1 from public.leave_requests where employee_id=e.id and state='approved' and portion='full_day' and p_date between start_date and end_date) then 'excused'::public.attendance_result else 'absent'::public.attendance_result end,
 revision=revision+1,updated_at=now() where id=d.id;
 insert into public.attendance_events(organization_id,attendance_day_id,actor_user_id,event_kind,request_id,payload) values(org,d.id,auth.uid(),case when p_remove then 'excused_removed' else 'excused_set' end,request,jsonb_build_object('reason',trim(p_reason),'before',to_jsonb(d)));
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata) values(org,auth.uid(),case when p_remove then 'excused_removed' else 'excused_set' end,'attendance_day',d.id::text,request,jsonb_build_object('reason',trim(p_reason),'before',to_jsonb(d)));
end $$;

create or replace function public.reconcile_attendance_date(p_date date,p_org uuid default null)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_emp public.employees; v_context text; v_count int:=0; v_result public.attendance_result;
begin
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
