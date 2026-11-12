create function public.admin_record_manual_attendance(
 p_employee uuid,p_work_date date,p_check_in time,p_check_out time,p_reason text,p_request_id uuid
)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; d public.attendance_days; zone text; correction_id uuid;
begin
 perform public.assert_admin();
 select * into e from public.employees
 where id=p_employee and organization_id=public.current_organization_id() and active;
 if e.id is null or not public.is_reviewer_for(e.id) then raise exception 'Employee unavailable for manual attendance'; end if;
 if p_work_date is null or p_request_id is null or p_check_in is null or p_check_out is null or p_check_out<=p_check_in
 then raise exception 'Enter a valid date and a check-out after check-in'; end if;
 if p_reason is null or length(trim(p_reason)) not between 10 and 500
 then raise exception 'Enter a reason of 10 to 500 characters'; end if;
 select timezone into zone from public.organizations where id=e.organization_id;
 if ((p_work_date+p_check_out) at time zone zone)>now() or public.day_context(e,p_work_date)<>'working_day'
 then raise exception 'Manual attendance requires a working day and times that have already passed'; end if;

 perform public.lock_attendance_range(e.organization_id,p_work_date,p_work_date);
 perform pg_advisory_xact_lock(hashtextextended(e.id::text||':attendance-leave',0));
 if exists(select 1 from public.attendance_corrections where employee_id=e.id and work_date=p_work_date and state='pending')
 then raise exception 'Review the pending correction in Approvals'; end if;

 insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context)
 values(e.organization_id,e.id,p_work_date,e.branch_id,e.policy_id,'working_day')
 on conflict(organization_id,employee_id,work_date) do nothing;
 select * into d from public.attendance_days
 where organization_id=e.organization_id and employee_id=e.id and work_date=p_work_date for update;
 if d.check_in_at is not null or d.check_out_at is not null
 then raise exception 'Attendance already has a punch. Use the correction request workflow'; end if;
 if d.result='excused' then raise exception 'This day already has an excused absence'; end if;

 insert into public.attendance_corrections(organization_id,employee_id,work_date,base_revision,
  proposed_check_in,proposed_check_out,reason,requested_by,request_id)
 values(e.organization_id,e.id,p_work_date,d.revision,(p_work_date+p_check_in) at time zone zone,
  (p_work_date+p_check_out) at time zone zone,trim(p_reason),auth.uid(),p_request_id)
 returning id into correction_id;
 perform public.decide_attendance_correction(correction_id,'approved','Entered manually by an administrator',p_request_id);
end $$;

revoke all on function public.admin_record_manual_attendance(uuid,date,time,time,text,uuid) from public,anon;
grant execute on function public.admin_record_manual_attendance(uuid,date,time,time,text,uuid) to authenticated;
