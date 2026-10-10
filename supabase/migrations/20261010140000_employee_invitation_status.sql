create or replace function public.employee_directory()
returns jsonb language sql stable security definer set search_path=public,auth as $$
  select case when public.has_portal_role(array['admin','partner']::public.portal_role[]) then coalesce(jsonb_agg(jsonb_build_object('id',e.id,'code',e.employee_code,'name',e.full_name,'email',e.work_email,'department',e.department,'branch',b.name,'manager',m.full_name,'status',case when e.active then 'active' else 'inactive' end,'accountLinked',e.profile_user_id is not null) order by e.full_name),'[]'::jsonb) else '[]'::jsonb end
  from public.employees e join public.branches b on b.id=e.branch_id left join public.employees m on m.id=e.manager_id where e.organization_id=public.current_organization_id();
$$;
