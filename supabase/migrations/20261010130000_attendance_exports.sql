create or replace function public.attendance_export_rows(p_month text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeCode',e.employee_code,'employeeName',e.full_name,'department',e.department,'workDate',d.work_date,
    'context',d.calendar_context,'checkIn',to_char(d.check_in_at at time zone o.timezone,'YYYY-MM-DD HH24:MI'),
    'checkOut',to_char(d.check_out_at at time zone o.timezone,'YYYY-MM-DD HH24:MI'),'durationMinutes',d.duration_minutes,
    'result',d.result,'late',d.is_late,'earlyDeparture',d.is_early_departure
  ) order by e.full_name,d.work_date),'[]'::jsonb)
  from public.attendance_days d join public.employees e on e.id=d.employee_id join public.organizations o on o.id=d.organization_id
  where d.organization_id=public.current_organization_id() and to_char(d.work_date,'YYYY-MM')=p_month
    and (public.has_portal_role(array['admin','partner']::public.portal_role[]) or public.can_view_employee(d.employee_id));
$$;
grant execute on function public.attendance_export_rows(text) to authenticated;
