-- Preserve organization/assignment/onboarding access while allowing indexed scans.
create function public.crm_visible_owners()
returns setof uuid language sql stable security definer set search_path=public,auth as $$
 select e.id from public.employees e join public.profiles p on p.user_id=auth.uid()
 where p.active and not p.password_change_required and e.organization_id=p.organization_id
 and (e.id=p.employee_id or (p.role='manager' and e.manager_id=p.employee_id));
$$;
revoke all on function public.crm_visible_owners() from public,anon;
grant execute on function public.crm_visible_owners() to authenticated;

create extension if not exists pg_trgm with schema extensions;
do $$ declare t text; trigram_schema text; begin
 select n.nspname into trigram_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
 foreach t in array array['crm_clients','crm_leads','crm_documents','crm_compliance','crm_invoices','crm_tasks','crm_support','crm_automation_events'] loop
  execute format('alter policy crm_read on public.%I using (
   organization_id=(select public.current_organization_id())
   and not coalesce((select password_change_required from public.profiles where user_id=(select auth.uid())),true)
   and ((select public.has_portal_role(array[''admin'',''partner'']::public.portal_role[]))
    or owner_id in (select public.crm_visible_owners()))
  )',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create index %I on public.%I(organization_id,created_at desc,id)',t||'_organization_recent',t);
  execute format('create index %I on public.%I(organization_id,status,created_at desc,id)',t||'_organization_status',t);
  if t<>'crm_automation_events' then
   execute format('create index %I on public.%I using gin(title %I.gin_trgm_ops)',t||'_title_search',t,trigram_schema);
  end if;
 end loop;
end $$;
create index employees_organization_manager on public.employees(organization_id,manager_id);
create index crm_compliance_due_queue on public.crm_compliance(due_date) where status<>'filed';
create index crm_tasks_due_queue on public.crm_tasks(due_date) where status<>'done';
create index audit_organization_recent on public.audit_logs(organization_id,created_at desc);
create index correction_requester_recent on public.attendance_corrections(requested_by,requested_at desc);
