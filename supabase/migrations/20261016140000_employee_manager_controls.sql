-- Reporting manager is independent of the Employee / Administrator account role.
create or replace function public.admin_employee_manager(p_employee uuid, p_manager uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare target public.employees; previous_manager uuid;
begin
 perform public.assert_admin();
 perform 1 from public.organizations where id=public.current_organization_id() for update;
 select * into target from public.employees
 where id=p_employee and organization_id=public.current_organization_id() for update;
 if target.id is null then raise exception 'Employee unavailable'; end if;
 previous_manager := target.manager_id;
 if p_manager is not null then
  if p_manager=target.id then raise exception 'An employee cannot report to themselves'; end if;
  if not exists(select 1 from public.employees where id=p_manager and organization_id=target.organization_id and active)
  then raise exception 'Choose an active reporting manager from this firm'; end if;
  if exists(
   with recursive chain as (
    select id,manager_id from public.employees where id=p_manager and organization_id=target.organization_id
    union
    select e.id,e.manager_id from public.employees e join chain c on e.id=c.manager_id
    where e.organization_id=target.organization_id
   ) select 1 from chain where id=target.id
  ) then raise exception 'Reporting relationships cannot form a cycle'; end if;
 end if;
 update public.employees set manager_id=p_manager,updated_at=now() where id=target.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(target.organization_id,auth.uid(),'employee_manager_changed','employee',target.id::text,gen_random_uuid(),
 jsonb_build_object('previousManager',previous_manager,'manager',p_manager));
end $$;
revoke all on function public.admin_employee_manager(uuid,uuid) from public,anon;
grant execute on function public.admin_employee_manager(uuid,uuid) to authenticated;

create or replace function public.employee_directory()
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select case when public.has_portal_role(array['admin']::public.portal_role[]) then coalesce(jsonb_agg(jsonb_build_object(
 'id',e.id,'code',e.employee_code,'name',e.full_name,'email',e.work_email,'department',e.department,'branch',b.name,
 'manager',m.full_name,'managerId',e.manager_id,'status',case when e.active then 'active' else 'inactive' end,
 'accountLinked',e.profile_user_id is not null,'role',coalesce(p.role,'employee'),'joinedOn',e.joined_on)
 order by e.full_name),'[]'::jsonb) else '[]'::jsonb end
 from public.employees e join public.branches b on b.id=e.branch_id
 left join public.employees m on m.id=e.manager_id left join public.profiles p on p.user_id=e.profile_user_id
 where e.organization_id=public.current_organization_id();
$$;
