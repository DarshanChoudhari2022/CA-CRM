-- CRM is an Administrator workspace. Retain compatibility with both labels
-- recognized by isAdministrator without changing the employee/admin role model.
-- Assignment is business metadata and never grants workspace access.

create or replace function public.crm_can_access(p_org uuid,p_owner uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select coalesce(p_org=public.current_organization_id()
  and public.has_portal_role(array['admin','partner']::public.portal_role[]),false);
$$;

create or replace function public.crm_visible_owners()
returns setof uuid language sql stable security definer set search_path=public,auth as $$
 select e.id from public.employees e where e.organization_id=public.current_organization_id()
 and public.has_portal_role(array['admin','partner']::public.portal_role[]);
$$;

-- Replace the optimized owner-list policies as well as the helper: changing
-- crm_can_access alone leaves direct table reads through crm_visible_owners.
do $$ declare t text; begin
 foreach t in array array['crm_clients','crm_leads','crm_documents','crm_compliance',
  'crm_tasks','crm_support','crm_invoices','crm_automation_events'] loop
  execute format('alter policy crm_read on public.%I using(public.crm_can_access(organization_id,null))',t);
 end loop;
end $$;
alter policy payment_read on public.crm_payments using(public.crm_can_access(organization_id,null));

create or replace function public.crm_invoice_receipts(p_ids uuid[])
returns table(invoice_id uuid,received numeric) language sql stable security definer set search_path=public,auth as $$
 select i.id,coalesce(sum(p.amount),0) from public.crm_invoices i left join public.crm_payments p on p.invoice_id=i.id
 where i.id=any(p_ids) and public.crm_can_access(i.organization_id,i.owner_id) group by i.id;
$$;

-- Keep client-owner propagation and invoice protection compatible with partner.
create or replace function public.crm_follow_client_assignment()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare client public.crm_clients;
begin
 if new.client_id is not null then
  select * into client from public.crm_clients where id=new.client_id and organization_id=new.organization_id for share;
  if client.id is null then raise exception 'Client unavailable'; end if;
  if auth.uid() is not null and not public.crm_can_access(client.organization_id,client.owner_id) then raise exception 'Administrator CRM access required'; end if;
  new.owner_id:=client.owner_id;
 end if;
 if tg_table_name='crm_invoices' and auth.uid() is not null and not public.has_portal_role(array['admin','partner']::public.portal_role[]) then
  raise exception 'Administrator required for invoices';
 end if;
 return new;
end $$;

-- Approved knowledge, creator-owned jobs, and empty/snapshot-only contexts are
-- CRM data too. No creator, employee-owner, or approved-reference exception.
alter policy ca_knowledge_read on public.ca_knowledge using(public.crm_can_access(organization_id,null));
alter policy ca_job_read on public.ca_agent_jobs using(public.crm_can_access(organization_id,null));
create or replace function public.ca_context_visible(p_org uuid,p_sources jsonb)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select public.crm_can_access(p_org,null);
$$;

-- Guard before the idempotent return and before inserts: a client-less request
-- would otherwise skip crm_can_access entirely in this SECURITY DEFINER RPC.
create or replace function public.ca_create_job(p_kind text,p_title text,p_brief text,p_jurisdiction text,p_period text,p_client uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); job uuid; existing public.ca_agent_jobs;
begin
 if not public.crm_can_access(org,null) then raise exception 'Administrator CRM access required'; end if;
 if p_request is null then raise exception 'Request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||':ca-create:'||auth.uid()::text,0));
 select * into existing from public.ca_agent_jobs where organization_id=org and created_by=auth.uid() and request_id=p_request;
 if existing.id is not null then
  if (existing.kind,existing.title,existing.brief,existing.jurisdiction,existing.period,existing.client_id)
   is distinct from (p_kind,trim(p_title),trim(p_brief),trim(p_jurisdiction),trim(p_period),p_client) then raise exception 'Request ID already used for another brief'; end if;
  return existing.id;
 end if;
 if (select count(*) from public.ca_agent_jobs where organization_id=org and created_by=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly workpaper limit reached'; end if;
 if p_client is not null and not exists(select 1 from public.crm_clients where id=p_client and public.crm_can_access(organization_id,owner_id)) then raise exception 'Client unavailable'; end if;
 insert into public.ca_agent_jobs(organization_id,created_by,owner_id,kind,title,brief,jurisdiction,period,client_id,request_id)
 values(org,auth.uid(),public.current_employee_id(),p_kind,trim(p_title),trim(p_brief),trim(p_jurisdiction),trim(p_period),p_client,p_request) returning id into job;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
 values(org,auth.uid(),'ca_workpaper_created','ca_agent_job',job::text,p_request);
 return job;
end $$;

-- CREATE OR REPLACE retains existing ACLs/OIDs. In particular the legacy
-- ca_context_visible_before_invoice_restriction stays private, ca_finish_job
-- stays service-only, and document/storage operations still authorize through
-- crm_can_access. Unchanged admin RPCs use has_portal_role(admin,partner).
