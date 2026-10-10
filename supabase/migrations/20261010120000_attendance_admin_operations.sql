-- Administrative operations for the attendance and leave module.

create or replace function public.assert_admin()
returns void language plpgsql stable security definer set search_path=public,auth as $$
begin
  if not public.has_portal_role(array['admin','partner']::public.portal_role[]) then raise exception 'FORBIDDEN: Administrator access required.'; end if;
end;
$$;

create or replace function public.employee_form_options()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) from public.branches where organization_id=public.current_organization_id() and active),
    'policies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by effective_from desc),'[]'::jsonb) from public.attendance_policies where organization_id=public.current_organization_id()),
    'managers',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name) order by e.full_name),'[]'::jsonb) from public.employees e left join public.profiles p on p.employee_id=e.id where e.organization_id=public.current_organization_id() and e.active and coalesce(p.role,'employee') in ('manager','admin','partner'))
  );
end;
$$;

create or replace function public.admin_add_employee(p_code text,p_name text,p_email text,p_department text,p_branch_id uuid,p_policy_id uuid,p_manager_id uuid,p_joined_on date,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid; v_id uuid; v_year int:=extract(year from p_joined_on);
begin
  perform public.assert_admin(); v_org:=public.current_organization_id();
  if char_length(trim(p_code))<2 or char_length(trim(p_name))<2 or position('@' in p_email)<2 then raise exception 'INVALID_INPUT: Complete the employee details.'; end if;
  if not exists(select 1 from public.branches where id=p_branch_id and organization_id=v_org and active) then raise exception 'INVALID_INPUT: Invalid branch.'; end if;
  if not exists(select 1 from public.attendance_policies where id=p_policy_id and organization_id=v_org) then raise exception 'INVALID_INPUT: Invalid policy.'; end if;
  if p_manager_id is not null and not exists(select 1 from public.employees where id=p_manager_id and organization_id=v_org and active) then raise exception 'INVALID_INPUT: Invalid manager.'; end if;
  insert into public.employees(organization_id,employee_code,full_name,work_email,department,branch_id,manager_id,policy_id,joined_on)
  values(v_org,upper(trim(p_code)),trim(p_name),lower(trim(p_email))::citext,coalesce(nullif(trim(p_department),''),'General'),p_branch_id,p_manager_id,p_policy_id,p_joined_on) returning id into v_id;
  insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated)
  select v_org,v_id,id,v_year,default_days from public.leave_types where organization_id=v_org and active;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata) values(v_org,auth.uid(),'employee_created','employee',v_id::text,p_request_id,jsonb_build_object('email',lower(trim(p_email))));
  return v_id;
end;
$$;

create or replace function public.admin_create_leave_type(p_name text,p_code text,p_default_days numeric,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid;v_id uuid;
begin
  perform public.assert_admin(); v_org:=public.current_organization_id();
  if char_length(trim(p_name))<2 or char_length(trim(p_code))<1 or p_default_days<0 then raise exception 'INVALID_INPUT: Invalid leave type.'; end if;
  insert into public.leave_types(organization_id,name,code,default_days) values(v_org,trim(p_name),upper(trim(p_code)),p_default_days) returning id into v_id;
  insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated) select v_org,id,v_id,extract(year from current_date),p_default_days from public.employees where organization_id=v_org and active;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v_org,auth.uid(),'leave_type_created','leave_type',v_id::text,p_request_id);
  return v_id;
end;
$$;

create or replace function public.admin_create_policy(p_name text,p_effective_from date,p_shift_start time,p_shift_end time,p_grace integer,p_full_day integer,p_half_day integer,p_correction_window integer,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid;v_id uuid;
begin
  perform public.assert_admin();v_org:=public.current_organization_id();
  if p_effective_from<current_date or p_shift_end<=p_shift_start or p_grace<0 or p_half_day<=0 or p_full_day<p_half_day or p_correction_window<0 then raise exception 'INVALID_INPUT: Invalid attendance policy.'; end if;
  if p_full_day>floor(extract(epoch from (p_shift_end-p_shift_start))/60) then raise exception 'INVALID_INPUT: Full-day threshold exceeds shift length.'; end if;
  insert into public.attendance_policies(organization_id,name,effective_from,shift_start,shift_end,grace_minutes,full_day_minutes,half_day_minutes,correction_window_days)
  values(v_org,trim(p_name),p_effective_from,p_shift_start,p_shift_end,p_grace,p_full_day,p_half_day,p_correction_window) returning id into v_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v_org,auth.uid(),'policy_created','attendance_policy',v_id::text,p_request_id);
  return v_id;
end;
$$;

create or replace function public.close_attendance_month(p_month text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid;v_start date:=(p_month||'-01')::date;v_blockers int;
begin
  perform public.assert_admin();v_org:=public.current_organization_id();
  if v_start>=date_trunc('month',current_date)::date then raise exception 'INVALID_INPUT: Only completed months can be closed.'; end if;
  insert into public.attendance_months(organization_id,month_start) values(v_org,v_start) on conflict do nothing;
  perform 1 from public.attendance_months where organization_id=v_org and month_start=v_start for update;
  select (select count(*) from public.attendance_days where organization_id=v_org and work_date>=v_start and work_date<(v_start+interval '1 month') and check_in_at is not null and check_out_at is null)
    +(select count(*) from public.attendance_corrections where organization_id=v_org and work_date>=v_start and work_date<(v_start+interval '1 month') and state='pending') into v_blockers;
  if v_blockers>0 then raise exception 'INVALID_INPUT: Resolve % blocking records first.',v_blockers; end if;
  update public.attendance_months set state='closed',revision=revision+1,closed_at=now(),closed_by=auth.uid() where organization_id=v_org and month_start=v_start;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v_org,auth.uid(),'month_closed','attendance_month',p_month,p_request_id);
end;
$$;

create or replace function public.reopen_attendance_month(p_month text,p_reason text,p_request_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid;v_start date:=(p_month||'-01')::date;
begin
  perform public.assert_admin();v_org:=public.current_organization_id();
  if char_length(trim(p_reason))<10 then raise exception 'INVALID_INPUT: Explain why the month must be reopened.'; end if;
  update public.attendance_months set state='open',revision=revision+1,reopened_at=now(),reopened_by=auth.uid(),reopen_reason=trim(p_reason) where organization_id=v_org and month_start=v_start and state='closed';
  if not found then raise exception 'INVALID_INPUT: The month is not closed.'; end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata) values(v_org,auth.uid(),'month_reopened','attendance_month',p_month,p_request_id,jsonb_build_object('reason',trim(p_reason)));
end;
$$;

grant execute on function public.assert_admin() to authenticated;
grant execute on function public.employee_form_options() to authenticated;
grant execute on function public.admin_add_employee(text,text,text,text,uuid,uuid,uuid,date,uuid) to authenticated;
grant execute on function public.admin_create_leave_type(text,text,numeric,uuid) to authenticated;
grant execute on function public.admin_create_policy(text,date,time,time,integer,integer,integer,integer,uuid) to authenticated;
grant execute on function public.close_attendance_month(text,uuid) to authenticated;
grant execute on function public.reopen_attendance_month(text,text,uuid) to authenticated;
