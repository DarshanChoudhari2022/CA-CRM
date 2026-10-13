-- Refresh a changed source immediately; do not run the whole firm's scheduler on a user's edit.
create function public.crm_refresh_source_reminders()
returns trigger language plpgsql security definer set search_path=public as $$
declare module text; closed boolean; local_date date; eligible boolean;
begin
 module:=case tg_table_name when 'crm_tasks' then 'tasks' else 'compliance' end;
 closed:=new.status=case when module='tasks' then 'done' else 'filed' end;
 select (now() at time zone timezone)::date into local_date from public.organizations where id=new.organization_id;
 update public.crm_automation_events set status='cancelled',updated_at=now()
 where source_module=module and source_id=new.id and status='queued' and (closed or source_due_date is distinct from new.due_date);
 update public.crm_automation_events set title=(case when module='tasks' then 'Task due: ' else 'Compliance due: ' end)||new.title,
 owner_id=new.owner_id,notes='Due '||new.due_date,updated_at=now()
 where source_module=module and source_id=new.id and status='queued';
 eligible:=not closed and new.due_date is not null and (case when module='tasks' then new.due_date<=local_date+1 else new.due_date-local_date in (7,3,1,0) or new.due_date<local_date end);
 if eligible then
  insert into public.crm_automation_events(organization_id,title,source_module,source_id,owner_id,notes,occurrence_date,source_due_date)
  values(new.organization_id,(case when module='tasks' then 'Task due: ' else 'Compliance due: ' end)||new.title,module,new.id,new.owner_id,'Due '||new.due_date,local_date,new.due_date)
  on conflict(source_module,source_id,source_due_date,occurrence_date) do nothing;
  update public.crm_automation_events e set status='cancelled',updated_at=now()
  where e.source_module=module and e.source_id=new.id and e.status='queued' and e.source_due_date=new.due_date and e.occurrence_date<local_date;
 end if;
 return new;
end $$;
revoke all on function public.crm_refresh_source_reminders() from public,anon,authenticated;
create trigger task_reminder_refresh after insert or update of title,status,due_date,owner_id on public.crm_tasks for each row execute function public.crm_refresh_source_reminders();
create trigger compliance_reminder_refresh after insert or update of title,status,due_date,owner_id on public.crm_compliance for each row execute function public.crm_refresh_source_reminders();
