create function public.cancel_workspace_request(p_kind text,p_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare t text; r jsonb;
begin
 t=case p_kind when 'leave' then 'leave_requests' when 'attendance' then 'attendance_corrections' end;
 if t is null then raise exception 'Invalid request type'; end if;
 execute format('select to_jsonb(r) from public.%I r where id=$1 and requested_by=auth.uid() and organization_id=public.current_organization_id() for update',t) into r using p_id;
 if r is null or r->>'state'<>'pending' then raise exception 'Only your pending request can be cancelled'; end if;
 execute format('update public.%I set state=''cancelled'' where id=$1',t) using p_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(public.current_organization_id(),auth.uid(),'request_cancelled',t,p_id::text,gen_random_uuid());
end $$;
revoke all on function public.cancel_workspace_request(text,uuid) from public,anon;
grant execute on function public.cancel_workspace_request(text,uuid) to authenticated;

create function public.admin_update_employee(p_id uuid,p_manager uuid,p_department text,p_role public.portal_role,p_active boolean,p_last_date date)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; old_role public.portal_role;
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) then raise exception 'Administrator required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(public.current_organization_id()::text,0));
 select * into e from public.employees where id=p_id and organization_id=public.current_organization_id() for update;
 if e.id is null or length(trim(p_department)) not between 1 and 100 then raise exception 'Invalid employee or department'; end if;
 if e.profile_user_id=auth.uid() and (not p_active or p_role not in ('admin','partner')) then raise exception 'You cannot remove your own administrator access'; end if;
 if p_last_date is not null and p_last_date<e.joined_on then raise exception 'Leaving date precedes joining date'; end if;
 if p_manager is not null then
  if not exists(select 1 from public.employees where id=p_manager and organization_id=e.organization_id and active) then raise exception 'Invalid manager'; end if;
  if exists(with recursive chain as(select id,manager_id from public.employees where id=p_manager union select x.id,x.manager_id from public.employees x join chain c on x.id=c.manager_id) select 1 from chain where id=e.id) then raise exception 'Manager assignment creates a cycle'; end if;
 end if;
 select role into old_role from public.profiles where user_id=e.profile_user_id;
 if old_role in ('admin','partner') and (not p_active or p_role not in ('admin','partner')) and (select count(*) from public.profiles where organization_id=e.organization_id and active and role in ('admin','partner'))<=1 then raise exception 'The last administrator must remain active'; end if;
 update public.employees set manager_id=p_manager,department=trim(p_department),active=p_active,last_working_on=p_last_date,updated_at=now() where id=e.id;
 update public.profiles set role=p_role,active=p_active where user_id=e.profile_user_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata) values(e.organization_id,auth.uid(),'employee_updated','employee',e.id::text,gen_random_uuid(),jsonb_build_object('before',to_jsonb(e),'role',p_role,'active',p_active));
end $$;
revoke all on function public.admin_update_employee(uuid,uuid,text,public.portal_role,boolean,date) from public,anon;
grant execute on function public.admin_update_employee(uuid,uuid,text,public.portal_role,boolean,date) to authenticated;

create function public.admin_add_holiday(p_branch uuid,p_date date,p_name text)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) then raise exception 'Administrator required'; end if;
 if p_date<=(now() at time zone 'Asia/Kolkata')::date or length(trim(p_name)) not between 1 and 100 then raise exception 'Choose a future date and valid name'; end if;
 if not exists(select 1 from public.branches where id=p_branch and organization_id=public.current_organization_id()) then raise exception 'Invalid branch'; end if;
 insert into public.holidays(organization_id,branch_id,holiday_date,name) values(public.current_organization_id(),p_branch,p_date,trim(p_name));
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(public.current_organization_id(),auth.uid(),'holiday_created','holiday',p_date::text,gen_random_uuid());
end $$;
revoke all on function public.admin_add_holiday(uuid,date,text) from public,anon;
grant execute on function public.admin_add_holiday(uuid,date,text) to authenticated;

create function public.admin_excuse_day(p_employee uuid,p_date date,p_reason text,p_remove boolean)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; d public.attendance_days;
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) or p_employee=public.current_employee_id() then raise exception 'Non-self administrator required'; end if;
 select * into e from public.employees where id=p_employee and organization_id=public.current_organization_id() for update;
 if e.id is null or p_date>=(now() at time zone 'Asia/Kolkata')::date or public.day_context(e,p_date)<>'working_day' or length(trim(p_reason)) not between 10 and 500 then raise exception 'Choose a past working day and a reason of 10–500 characters'; end if;
 if public.month_is_closed(e.organization_id,p_date) then raise exception 'Month is closed'; end if;
 insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context) values(e.organization_id,e.id,p_date,e.branch_id,e.policy_id,'working_day') on conflict do nothing;
 select * into d from public.attendance_days where employee_id=e.id and work_date=p_date for update;
 if d.check_in_at is not null or exists(select 1 from public.attendance_corrections where employee_id=e.id and work_date=p_date and state='pending') then raise exception 'Punches or a pending correction prevent annotation'; end if;
 update public.attendance_days set result=case when p_remove then 'absent'::public.attendance_result else 'excused'::public.attendance_result end,revision=revision+1,updated_at=now() where id=d.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata) values(e.organization_id,auth.uid(),case when p_remove then 'excused_removed' else 'excused_set' end,'attendance_day',d.id::text,gen_random_uuid(),jsonb_build_object('reason',trim(p_reason),'before',to_jsonb(d)));
end $$;
revoke all on function public.admin_excuse_day(uuid,date,text,boolean) from public,anon;
grant execute on function public.admin_excuse_day(uuid,date,text,boolean) to authenticated;
