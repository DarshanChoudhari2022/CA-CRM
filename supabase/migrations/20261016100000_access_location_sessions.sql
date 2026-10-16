-- Two user-facing roles. Preserve enum labels used by older function definitions.
update public.profiles set role='admin' where role='partner';
update public.profiles set role='employee' where role='manager';
alter table public.profiles add constraint portal_two_roles check(role in ('employee','admin'));

-- Refreshing an access token must not extend the original sign-in past 03:00 IST.
create function public.portal_session_deadline()
returns timestamptz language sql stable security definer set search_path=public,auth as $$
 select (date_trunc('day',s.created_at at time zone 'Asia/Kolkata'-interval '3 hours')
  +interval '1 day 3 hours') at time zone 'Asia/Kolkata'
 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid();
$$;
revoke all on function public.portal_session_deadline() from public,anon;
grant execute on function public.portal_session_deadline() to authenticated;

create function public.portal_session_context()
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select jsonb_build_object('expiresAt',public.portal_session_deadline(),'joinedOn',e.joined_on)
 from public.profiles p left join public.employees e on e.id=p.employee_id and e.organization_id=p.organization_id
 where p.user_id=auth.uid() and p.active;
$$;
revoke all on function public.portal_session_context() from public,anon;
grant execute on function public.portal_session_context() to authenticated;

create or replace function public.portal_access_allowed()
returns boolean language sql stable security definer set search_path=public,auth as $$
 select coalesce(public.portal_session_deadline()>now(),false) and exists(
  select 1 from public.profiles p where p.user_id=auth.uid() and p.active and not p.password_change_required
  and (p.employee_id is null or exists(select 1 from public.employees e
    where e.id=p.employee_id and e.organization_id=p.organization_id and e.active)));
$$;

create or replace function public.current_portal_identity()
returns table ("userId" uuid,"fullName" text,role public.portal_role,"employeeId" uuid,"organizationId" uuid)
language sql stable security definer set search_path=public,auth as $$
 select p.user_id,p.full_name,p.role,p.employee_id,p.organization_id from public.profiles p
 where p.user_id=auth.uid() and p.active and public.portal_session_deadline()>now()
 and (p.employee_id is null or exists(select 1 from public.employees e where e.id=p.employee_id and e.organization_id=p.organization_id and e.active));
$$;

create or replace function public.can_view_employee(target_employee_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p join public.employees e
 on e.id=target_employee_id and e.organization_id=p.organization_id
 where p.user_id=auth.uid() and public.portal_access_allowed() and (p.employee_id=e.id or p.role='admin'));
$$;

create function public.admin_employee_access(p_employee uuid,p_role text,p_active boolean)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; previous public.profiles;
begin
 perform public.assert_admin();
 if p_role is null or p_role not in ('employee','admin') or p_active is null then raise exception 'Invalid role or status'; end if;
 -- Serialize access changes, including concurrent attempts to remove the last administrator.
 perform 1 from public.organizations where id=public.current_organization_id() for update;
 select * into e from public.employees where id=p_employee and organization_id=public.current_organization_id() for update;
 if e.id is null then raise exception 'Employee unavailable'; end if;
 select * into previous from public.profiles where user_id=e.profile_user_id for update;
 if e.profile_user_id=auth.uid() and (p_role<>'admin' or not p_active) then raise exception 'You cannot remove your own administrator access'; end if;
 if previous.role='admin' and (p_role<>'admin' or not p_active)
 and not exists(select 1 from public.profiles where organization_id=e.organization_id and role='admin' and active and user_id<>previous.user_id) then
  raise exception 'Keep at least one active administrator';
 end if;
 if previous.user_id is null and p_role<>'employee' then raise exception 'Create the login before changing its role'; end if;
 update public.employees set active=p_active,updated_at=now() where id=e.id;
 update public.profiles set role=p_role::public.portal_role,active=p_active where user_id=e.profile_user_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(e.organization_id,auth.uid(),'employee_access_changed','employee',e.id::text,gen_random_uuid(),
 jsonb_build_object('previousRole',previous.role,'previousActive',e.active,'role',p_role,'active',p_active));
end $$;
revoke all on function public.admin_employee_access(uuid,text,boolean) from public,anon;
grant execute on function public.admin_employee_access(uuid,text,boolean) to authenticated;

-- Both administrative forms use the same organization lock before any row lock.
alter function public.admin_update_employee(uuid,uuid,text,public.portal_role,boolean,date) rename to admin_update_employee_before_access;
revoke all on function public.admin_update_employee_before_access(uuid,uuid,text,public.portal_role,boolean,date) from public,anon,authenticated;
create function public.admin_update_employee(p_id uuid,p_manager uuid,p_department text,p_role public.portal_role,p_active boolean,p_last_date date)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 perform public.admin_employee_access(p_id,p_role::text,p_active);
 perform public.admin_update_employee_before_access(p_id,p_manager,p_department,p_role,p_active,p_last_date);
end $$;
revoke all on function public.admin_update_employee(uuid,uuid,text,public.portal_role,boolean,date) from public,anon;
grant execute on function public.admin_update_employee(uuid,uuid,text,public.portal_role,boolean,date) to authenticated;

-- Strict assignment: reporting relationships never grant access to another employee's clients.
create or replace function public.crm_can_access(p_org uuid,p_owner uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select coalesce(p_org=public.current_organization_id() and
 (public.has_portal_role(array['admin']::public.portal_role[]) or (p_owner is not null and p_owner=public.current_employee_id())),false);
$$;

create or replace function public.crm_visible_owners()
returns setof uuid language sql stable security definer set search_path=public,auth as $$
 select public.current_employee_id() where public.current_employee_id() is not null;
$$;

-- Linked records always follow their client's assignment. This also protects legacy
-- SECURITY DEFINER writers that authorize through owner_id rather than table RLS.
create function public.crm_follow_client_assignment()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare client public.crm_clients;
begin
 if new.client_id is not null then
  select * into client from public.crm_clients where id=new.client_id and organization_id=new.organization_id for share;
  if client.id is null then raise exception 'Client unavailable'; end if;
  if auth.uid() is not null and not public.crm_can_access(client.organization_id,client.owner_id) then raise exception 'Client is not assigned to you'; end if;
  new.owner_id:=client.owner_id;
 end if;
 if tg_table_name='crm_invoices' and auth.uid() is not null and not public.has_portal_role(array['admin']::public.portal_role[]) then
  raise exception 'Administrator required for invoices';
 end if;
 return new;
end $$;
revoke all on function public.crm_follow_client_assignment() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['crm_leads','crm_documents','crm_compliance','crm_tasks','crm_support','crm_invoices'] loop
  execute format('update public.%I r set owner_id=c.owner_id from public.crm_clients c where r.client_id=c.id and r.organization_id=c.organization_id and r.owner_id is distinct from c.owner_id',t);
  execute format('create trigger follow_client_assignment before insert or update on public.%I for each row execute function public.crm_follow_client_assignment()',t);
 end loop;
end $$;
create function public.crm_reassign_client_records()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare t text;
begin
 if new.owner_id is distinct from old.owner_id then
  foreach t in array array['crm_leads','crm_documents','crm_compliance','crm_tasks','crm_support','crm_invoices'] loop
   execute format('update public.%I set owner_id=$1,updated_at=now() where client_id=$2 and organization_id=$3',t) using new.owner_id,new.id,new.organization_id;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.crm_reassign_client_records() from public,anon,authenticated;
create trigger client_assignment_changed after update of owner_id on public.crm_clients for each row execute function public.crm_reassign_client_records();

alter policy crm_read on public.crm_invoices using(organization_id=public.current_organization_id() and public.has_portal_role(array['admin']::public.portal_role[]));
alter policy payment_read on public.crm_payments using(organization_id=public.current_organization_id() and public.has_portal_role(array['admin']::public.portal_role[]));
create or replace function public.crm_invoice_receipts(p_ids uuid[])
returns table(invoice_id uuid,received numeric) language sql stable security definer set search_path=public,auth as $$
 select i.id,coalesce(sum(p.amount),0) from public.crm_invoices i left join public.crm_payments p on p.invoice_id=i.id
 where i.id=any(p_ids) and i.organization_id=public.current_organization_id() and public.has_portal_role(array['admin']::public.portal_role[]) group by i.id;
$$;
-- Retained workpapers must not expose invoice snapshots to employees.
alter function public.ca_context_visible(uuid,jsonb) rename to ca_context_visible_before_invoice_restriction;
revoke all on function public.ca_context_visible_before_invoice_restriction(uuid,jsonb) from public,anon,authenticated;
create function public.ca_context_visible(p_org uuid,p_sources jsonb)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select public.ca_context_visible_before_invoice_restriction(p_org,p_sources) and
 (public.has_portal_role(array['admin']::public.portal_role[]) or not exists(
 select 1 from jsonb_array_elements(p_sources) s where s->>'id' like 'invoices:%'));
$$;
revoke all on function public.ca_context_visible(uuid,jsonb) from public,anon;
grant execute on function public.ca_context_visible(uuid,jsonb) to authenticated;
-- Policies bind function OIDs, so replace the policy after wrapping the helper.
alter policy ca_job_read on public.ca_agent_jobs using(
 organization_id=public.current_organization_id() and (public.has_portal_role(array['admin']::public.portal_role[])
 or (created_by=auth.uid() and public.ca_context_visible(organization_id,sources)
 and (client_id is null or exists(select 1 from public.crm_clients c where c.id=client_id and public.crm_can_access(c.organization_id,c.owner_id))))));

create sequence public.crm_invoice_number_seq;
alter table public.crm_invoices add column invoice_number text not null default ('PSB-'||lpad(nextval('public.crm_invoice_number_seq')::text,8,'0'));
create unique index crm_invoice_number_unique on public.crm_invoices(invoice_number);

-- Each immutable punch event stores the location originally reported by the device.
create index attendance_event_location_lookup on public.attendance_events(attendance_day_id,event_kind,occurred_at) where event_kind in ('check_in','check_out');
create function public.record_attendance_punch(p_kind text,p_request_id uuid,p_location jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare result jsonb; lat double precision; lng double precision; accuracy double precision; captured timestamptz;
begin
 if p_location is null or jsonb_typeof(p_location)<>'object' then raise exception 'Location is required'; end if;
 lat:=(p_location->>'latitude')::double precision; lng:=(p_location->>'longitude')::double precision;
 accuracy:=(p_location->>'accuracy')::double precision; captured:=(p_location->>'capturedAt')::timestamptz;
 if lat is null or lng is null or accuracy is null or captured is null or not(lat between -90 and 90) or not(lng between -180 and 180)
 or not(accuracy between 0 and 100000) or captured<now()-interval '2 minutes' or captured>now()+interval '30 seconds' then raise exception 'A current valid location is required'; end if;
 result:=public.record_attendance_punch(p_kind,p_request_id);
 update public.attendance_events set payload=payload||jsonb_build_object('location',p_location)
 where actor_user_id=auth.uid() and event_kind=p_kind and request_id=p_request_id and not(payload ? 'location');
 return result;
end $$;
revoke all on function public.record_attendance_punch(text,uuid) from public,anon,authenticated;
revoke all on function public.record_attendance_punch(text,uuid,jsonb) from public,anon;
grant execute on function public.record_attendance_punch(text,uuid,jsonb) to authenticated;

create function public.attendance_punch_locations(p_employee uuid,p_date date)
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select jsonb_build_object(
 'checkInLocation',(select ev.payload->'location' from public.attendance_events ev join public.attendance_days d on d.id=ev.attendance_day_id
  where d.employee_id=p_employee and d.work_date=p_date and public.can_view_employee(d.employee_id) and ev.event_kind='check_in' order by ev.occurred_at limit 1),
 'checkOutLocation',(select ev.payload->'location' from public.attendance_events ev join public.attendance_days d on d.id=ev.attendance_day_id
  where d.employee_id=p_employee and d.work_date=p_date and public.can_view_employee(d.employee_id) and ev.event_kind='check_out' order by ev.occurred_at limit 1));
$$;
revoke all on function public.attendance_punch_locations(uuid,date) from public,anon,authenticated;

alter function public.my_attendance_history(text) rename to my_attendance_history_before_locations;
revoke all on function public.my_attendance_history_before_locations(text) from public,anon,authenticated;
create function public.my_attendance_history(p_month text)
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select coalesce(jsonb_agg(row||public.attendance_punch_locations(public.current_employee_id(),to_date(row->>'date','DD Mon YYYY')) order by ord),'[]'::jsonb)
 from jsonb_array_elements(public.my_attendance_history_before_locations(p_month)) with ordinality as rows(row,ord);
$$;
grant execute on function public.my_attendance_history(text) to authenticated;
revoke all on function public.my_attendance_history(text) from public,anon;

alter function public.attendance_register(date,uuid,text,text,text,integer) rename to attendance_register_before_locations;
revoke all on function public.attendance_register_before_locations(date,uuid,text,text,text,integer) from public,anon,authenticated;
create function public.attendance_register(p_date date,p_branch uuid default null,p_department text default '',p_search text default '',p_result text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare result jsonb;
begin
 result:=public.attendance_register_before_locations(p_date,p_branch,p_department,p_search,p_result,p_page);
 return jsonb_set(result,'{items}',(select coalesce(jsonb_agg(row||public.attendance_punch_locations((row->>'employee_id')::uuid,p_date) order by ord),'[]'::jsonb)
 from jsonb_array_elements(result->'items') with ordinality as rows(row,ord)));
end $$;
revoke all on function public.attendance_register(date,uuid,text,text,text,integer) from public,anon;
grant execute on function public.attendance_register(date,uuid,text,text,text,integer) to authenticated;

-- Joining-date restrictions also apply to direct database reads, not only the UI.
create function public.employee_date_visible(p_employee uuid,p_date date)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select public.can_view_employee(p_employee) and exists(select 1 from public.employees e where e.id=p_employee and p_date>=e.joined_on);
$$;
revoke all on function public.employee_date_visible(uuid,date) from public,anon;
grant execute on function public.employee_date_visible(uuid,date) to authenticated;
do $$ declare t text; column_name text; begin
 foreach t in array array['attendance_days','attendance_corrections','daily_work_items','daily_work_reports','leave_requests'] loop
  column_name:=case when t='leave_requests' then 'start_date' else 'work_date' end;
  execute format('create policy joining_date_read on public.%I as restrictive for select to authenticated using(public.employee_date_visible(employee_id,%I))',t,column_name);
 end loop;
end $$;
create policy joining_date_photo_read on public.daily_report_photos as restrictive for select to authenticated
using(exists(select 1 from public.daily_work_reports r where r.id=report_id and public.employee_date_visible(r.employee_id,r.work_date)));

create or replace function public.employee_directory()
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select case when public.has_portal_role(array['admin']::public.portal_role[]) then coalesce(jsonb_agg(jsonb_build_object(
 'id',e.id,'code',e.employee_code,'name',e.full_name,'email',e.work_email,'department',e.department,'branch',b.name,
 'manager',m.full_name,'status',case when e.active then 'active' else 'inactive' end,'accountLinked',e.profile_user_id is not null,
 'role',coalesce(p.role,'employee'),'joinedOn',e.joined_on) order by e.full_name),'[]'::jsonb) else '[]'::jsonb end
 from public.employees e join public.branches b on b.id=e.branch_id left join public.employees m on m.id=e.manager_id
 left join public.profiles p on p.user_id=e.profile_user_id where e.organization_id=public.current_organization_id();
$$;
