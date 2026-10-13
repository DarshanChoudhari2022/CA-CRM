-- Human-reviewed CA workpapers. No filing/payment/message side effects.
create table public.ca_knowledge (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 3 and 160), content text not null check(length(trim(content)) between 20 and 8000),
 source_url text not null check(source_url ~ '^https://[^[:space:]]+$'),
 jurisdiction text not null check(length(trim(jurisdiction)) between 2 and 120),
 valid_until date not null, state text not null default 'draft' check(state in ('draft','approved','retired')),
 created_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.ca_agent_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 created_by uuid not null references auth.users(id), owner_id uuid references public.employees(id), client_id uuid references public.crm_clients(id),
 kind text not null check(kind in ('taxation','compliance','legal','documentation','finance')),
 title text not null check(length(trim(title)) between 3 and 160), brief text not null check(length(trim(brief)) between 20 and 6000),
 jurisdiction text not null check(length(trim(jurisdiction)) between 2 and 120), period text not null check(length(trim(period)) between 2 and 120),
 state text not null default 'draft' check(state in ('draft','running','needs_review','approved','rejected','failed')),
 sources jsonb not null default '[]', output jsonb, model text, lease_id uuid, attempts integer not null default 0,
 error_message text, review_note text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 request_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,created_by,request_id)
);
alter table public.ca_knowledge enable row level security;
alter table public.ca_agent_jobs enable row level security;
create policy ca_knowledge_read on public.ca_knowledge for select to authenticated using (
 organization_id=(select public.current_organization_id())
 and not coalesce((select password_change_required from public.profiles where user_id=(select auth.uid())),true)
 and ((select public.has_portal_role(array['admin','partner']::public.portal_role[])) or state='approved')
);
create policy ca_job_read on public.ca_agent_jobs for select to authenticated using (
 organization_id=(select public.current_organization_id())
 and not coalesce((select password_change_required from public.profiles where user_id=(select auth.uid())),true)
 and ((select public.has_portal_role(array['admin','partner']::public.portal_role[])) or owner_id in (select public.crm_visible_owners()))
);
revoke all on public.ca_knowledge,public.ca_agent_jobs from anon,authenticated;
grant select on public.ca_knowledge,public.ca_agent_jobs to authenticated;
create index ca_job_recent on public.ca_agent_jobs(organization_id,created_at desc,id);
create index ca_job_owner on public.ca_agent_jobs(organization_id,owner_id,state);
create index ca_knowledge_valid on public.ca_knowledge(organization_id,jurisdiction,valid_until) where state='approved';

create function public.ca_create_job(p_kind text,p_title text,p_brief text,p_jurisdiction text,p_period text,p_client uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); job uuid; existing public.ca_agent_jobs;
begin
 if org is null or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Active workspace access required'; end if;
 if p_request is null then raise exception 'Request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||':ca-create:'||auth.uid()::text,0));
 select * into existing from public.ca_agent_jobs where organization_id=org and created_by=auth.uid() and request_id=p_request;
 if existing.id is not null then
  if (existing.kind,existing.title,existing.brief,existing.jurisdiction,existing.period,existing.client_id)
   is distinct from (p_kind,trim(p_title),trim(p_brief),trim(p_jurisdiction),trim(p_period),p_client) then raise exception 'Request ID already used for another brief'; end if;
  return existing.id;
 end if;
 if (select count(*) from public.ca_agent_jobs where organization_id=org and created_by=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly workpaper limit reached'; end if;
 if p_client is not null and not exists(select 1 from public.crm_clients where id=p_client and coalesce(public.crm_can_access(organization_id,owner_id),false)) then raise exception 'Client unavailable'; end if;
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) and public.current_employee_id() is null then raise exception 'Linked employee required'; end if;
 insert into public.ca_agent_jobs(organization_id,created_by,owner_id,kind,title,brief,jurisdiction,period,client_id,request_id)
 values(org,auth.uid(),public.current_employee_id(),p_kind,trim(p_title),trim(p_brief),trim(p_jurisdiction),trim(p_period),p_client,p_request) returning id into job;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
 values(org,auth.uid(),'ca_workpaper_created','ca_agent_job',job::text,p_request);
 return job;
end $$;

create function public.ca_start_job(p_id uuid,p_lease uuid,p_model text,p_sources jsonb)
returns void language plpgsql security definer set search_path=public,auth as $$
declare job public.ca_agent_jobs; org uuid:=public.current_organization_id();
begin
 perform pg_advisory_xact_lock(hashtextextended(org::text||':ca-ai',0));
 select * into job from public.ca_agent_jobs where id=p_id and organization_id=org for update;
 if job.id is null or not coalesce(public.crm_can_access(job.organization_id,job.owner_id),false)
 or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Workpaper unavailable'; end if;
 if job.state='running' and job.updated_at>now()-interval '5 minutes' then raise exception 'Draft already running'; end if;
 if job.state not in ('draft','failed','running') then raise exception 'Create a new workpaper to revise a completed draft'; end if;
 if p_lease is null or p_model is null or length(p_model) not between 1 and 160 or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources)>120 or octet_length(p_sources::text)>120000 then raise exception 'Invalid draft context'; end if;
 if (select count(*) from public.audit_logs where organization_id=org and action='ca_draft_started' and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly AI limit reached'; end if;
 update public.ca_agent_jobs set state='running',lease_id=p_lease,model=p_model,sources=p_sources,attempts=attempts+1,error_message=null,updated_at=now() where id=p_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(org,auth.uid(),'ca_draft_started','ca_agent_job',p_id::text,p_lease);
end $$;

-- Only the trusted server can persist provider results. Compare the current lease to reject stale completions.
create function public.ca_finish_job(p_id uuid,p_org uuid,p_lease uuid,p_output jsonb,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare job public.ca_agent_jobs;
begin
 select * into job from public.ca_agent_jobs where id=p_id and organization_id=p_org for update;
 if job.id is null or job.state<>'running' or job.lease_id is distinct from p_lease then raise exception 'Draft lease expired'; end if;
 if p_output is not null and (jsonb_typeof(p_output)<>'object' or octet_length(p_output::text)>40000) then raise exception 'Invalid draft output'; end if;
 if p_output is null and p_error is null then raise exception 'Draft result required'; end if;
 update public.ca_agent_jobs set state=case when p_output is null then 'failed' else 'needs_review' end,
  output=p_output,error_message=left(p_error,300),lease_id=null,updated_at=now() where id=p_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
 values(p_org,job.created_by,case when p_output is null then 'ca_draft_failed' else 'ca_draft_prepared' end,'ca_agent_job',p_id::text,p_lease);
end $$;

create function public.ca_review_job(p_id uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare job public.ca_agent_jobs;
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Administrator review required'; end if;
 if p_decision not in ('approved','rejected') or p_note is null or length(trim(p_note)) not between 10 and 2000 then raise exception 'Decision and review note required'; end if;
 select * into job from public.ca_agent_jobs where id=p_id and organization_id=public.current_organization_id() for update;
 if job.id is null or job.state<>'needs_review' then raise exception 'Workpaper is not awaiting review'; end if;
 update public.ca_agent_jobs set state=p_decision,review_note=trim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(job.organization_id,auth.uid(),'ca_workpaper_'||p_decision,'ca_agent_job',p_id::text,gen_random_uuid(),jsonb_build_object('review_note',trim(p_note)));
end $$;

create function public.ca_save_knowledge(p_title text,p_content text,p_url text,p_jurisdiction text,p_valid_until date)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare result uuid; org uuid:=public.current_organization_id();
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Administrator required'; end if;
 if p_valid_until is null or p_valid_until<current_date then raise exception 'Reference validity must be current'; end if;
 insert into public.ca_knowledge(organization_id,title,content,source_url,jurisdiction,valid_until,created_by)
 values(org,trim(p_title),trim(p_content),trim(p_url),trim(p_jurisdiction),p_valid_until,auth.uid()) returning id into result;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(org,auth.uid(),'ca_reference_created','ca_knowledge',result::text,gen_random_uuid());
 return result;
end $$;
create function public.ca_review_knowledge(p_id uuid,p_state text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare item public.ca_knowledge;
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Administrator required'; end if;
 select * into item from public.ca_knowledge where id=p_id and organization_id=public.current_organization_id() for update;
 if item.id is null or p_state not in ('approved','retired') or (p_state='approved' and item.valid_until<current_date) then raise exception 'Invalid reference review'; end if;
 update public.ca_knowledge set state=p_state,reviewed_by=auth.uid(),reviewed_at=now() where id=p_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(item.organization_id,auth.uid(),'ca_reference_'||p_state,'ca_knowledge',p_id::text,gen_random_uuid());
end $$;

revoke all on function public.ca_create_job(text,text,text,text,text,uuid,uuid),public.ca_start_job(uuid,uuid,text,jsonb),public.ca_review_job(uuid,text,text),public.ca_save_knowledge(text,text,text,text,date),public.ca_review_knowledge(uuid,text) from public,anon;
grant execute on function public.ca_create_job(text,text,text,text,text,uuid,uuid),public.ca_start_job(uuid,uuid,text,jsonb),public.ca_review_job(uuid,text,text),public.ca_save_knowledge(text,text,text,text,date),public.ca_review_knowledge(uuid,text) to authenticated;
revoke all on function public.ca_finish_job(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.ca_finish_job(uuid,uuid,uuid,jsonb,text) to service_role;
