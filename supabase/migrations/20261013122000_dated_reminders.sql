alter table public.crm_automation_events add column occurrence_date date;
alter table public.crm_automation_events add column source_due_date date;
update public.crm_automation_events e set occurrence_date=(e.created_at at time zone o.timezone)::date,
 source_due_date=coalesce(case when e.source_module='compliance' then (select due_date from public.crm_compliance where id=e.source_id)
 when e.source_module='tasks' then (select due_date from public.crm_tasks where id=e.source_id) end,(e.created_at at time zone o.timezone)::date)
from public.organizations o where o.id=e.organization_id;
alter table public.crm_automation_events alter column occurrence_date set not null;
alter table public.crm_automation_events alter column source_due_date set not null;
alter table public.crm_automation_events drop constraint crm_automation_events_source_module_source_id_key;
alter table public.crm_automation_events add constraint reminder_occurrence_unique unique(source_module,source_id,source_due_date,occurrence_date);
alter table public.crm_automation_events drop constraint crm_automation_events_status_check;
alter table public.crm_automation_events add constraint crm_automation_events_status_check check(status in ('queued','acknowledged','cancelled'));
create index reminder_pending_date on public.crm_automation_events(organization_id,occurrence_date desc) where status='queued';

create or replace function public.crm_queue_reminders()
returns void language plpgsql security definer set search_path=public as $$
begin
 -- Cancel obsolete pending work. Old completed occurrences remain part of history.
 update public.crm_automation_events e set status='cancelled',updated_at=now() where e.status='queued' and (
  (e.source_module='compliance' and not exists(select 1 from public.crm_compliance c where c.id=e.source_id and c.status<>'filed' and c.due_date=e.source_due_date))
  or (e.source_module='tasks' and not exists(select 1 from public.crm_tasks t where t.id=e.source_id and t.status<>'done' and t.due_date=e.source_due_date)));
 update public.crm_automation_events e set owner_id=c.owner_id,title='Compliance due: '||c.title,notes='Due '||c.due_date,updated_at=now()
 from public.crm_compliance c where e.source_module='compliance' and e.source_id=c.id and e.status='queued';
 update public.crm_automation_events e set owner_id=t.owner_id,title='Task due: '||t.title,notes='Due '||t.due_date,updated_at=now()
 from public.crm_tasks t where e.source_module='tasks' and e.source_id=t.id and e.status='queued';
 insert into public.crm_automation_events(organization_id,title,source_module,source_id,owner_id,notes,occurrence_date,source_due_date)
 select c.organization_id,'Compliance due: '||c.title,'compliance',c.id,c.owner_id,'Due '||c.due_date,(now() at time zone o.timezone)::date,c.due_date
 from public.crm_compliance c join public.organizations o on o.id=c.organization_id
 where c.status<>'filed' and (c.due_date-(now() at time zone o.timezone)::date in (7,3,1,0) or c.due_date<(now() at time zone o.timezone)::date)
 on conflict(source_module,source_id,source_due_date,occurrence_date) do nothing;
 insert into public.crm_automation_events(organization_id,title,source_module,source_id,owner_id,notes,occurrence_date,source_due_date)
 select t.organization_id,'Task due: '||t.title,'tasks',t.id,t.owner_id,'Due '||t.due_date,(now() at time zone o.timezone)::date,t.due_date
 from public.crm_tasks t join public.organizations o on o.id=t.organization_id
 where t.status<>'done' and t.due_date<=(now() at time zone o.timezone)::date+1
 on conflict(source_module,source_id,source_due_date,occurrence_date) do nothing;
 -- A newer occurrence replaces older pending notifications, without erasing acknowledged history.
 update public.crm_automation_events e set status='cancelled',updated_at=now() where e.status='queued' and exists(
  select 1 from public.crm_automation_events newer where newer.source_module=e.source_module and newer.source_id=e.source_id
   and newer.source_due_date=e.source_due_date and newer.occurrence_date>e.occurrence_date);
end $$;
revoke all on function public.crm_queue_reminders() from public,anon,authenticated;
grant execute on function public.crm_queue_reminders() to postgres,service_role;

alter policy crm_read on public.crm_automation_events using(
 organization_id=(select public.current_organization_id()) and (
  (select public.has_portal_role(array['admin','partner']::public.portal_role[]))
  or (source_module='compliance' and exists(select 1 from public.crm_compliance c where c.id=source_id))
  or (source_module='tasks' and exists(select 1 from public.crm_tasks t where t.id=source_id)))
);
create or replace function public.crm_acknowledge_event(p_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.crm_automation_events; permitted boolean;
begin
 select * into e from public.crm_automation_events where id=p_id and organization_id=public.current_organization_id() for update;
 permitted:=public.has_portal_role(array['admin','partner']::public.portal_role[])
  or (e.source_module='compliance' and exists(select 1 from public.crm_compliance c where c.id=e.source_id and public.crm_can_access(c.organization_id,c.owner_id)))
  or (e.source_module='tasks' and exists(select 1 from public.crm_tasks t where t.id=e.source_id and public.crm_can_access(t.organization_id,t.owner_id)));
 if e.id is null or not coalesce(permitted,false) or e.status='cancelled' then raise exception 'Reminder unavailable'; end if;
 if e.status='acknowledged' then return; end if;
 update public.crm_automation_events set status='acknowledged',updated_at=now() where id=e.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(e.organization_id,auth.uid(),'reminder_acknowledged','automation',e.id::text,gen_random_uuid());
end $$;
