create or replace function public.is_reviewer_for(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.profiles p
    join public.employees e on e.id = p_employee_id and e.organization_id = p.organization_id
    where p.user_id = auth.uid() and p.active and p.employee_id <> p_employee_id
      and (p.role in ('admin', 'partner') or (p.role = 'manager' and e.manager_id = p.employee_id))
  );
$$;
