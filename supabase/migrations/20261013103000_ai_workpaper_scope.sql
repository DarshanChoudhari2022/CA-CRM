-- Persisted snapshots must not widen the reader's source permissions.
create function public.ca_context_visible(p_org uuid,p_sources jsonb)
returns boolean language plpgsql stable security definer set search_path=public,auth as $$
declare source jsonb; kind text; record_id uuid; allowed boolean;
begin
 if p_org is distinct from public.current_organization_id() then return false; end if;
 if public.has_portal_role(array['admin','partner']::public.portal_role[]) then return true; end if;
 for source in select value from jsonb_array_elements(p_sources) loop
  if source->>'id'='snapshot-scope' then continue; end if;
  if (source->>'id') !~ '^(reference|client|compliance|documents|tasks|invoices):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  kind:=split_part(source->>'id',':',1); record_id:=split_part(source->>'id',':',2)::uuid;
  allowed:=false;
  case kind
   when 'reference' then select exists(select 1 from public.ca_knowledge where id=record_id and organization_id=p_org and state='approved') into allowed;
   when 'client' then select exists(select 1 from public.crm_clients where id=record_id and public.crm_can_access(organization_id,owner_id)) into allowed;
   when 'compliance' then select exists(select 1 from public.crm_compliance where id=record_id and public.crm_can_access(organization_id,owner_id)) into allowed;
   when 'documents' then select exists(select 1 from public.crm_documents where id=record_id and public.crm_can_access(organization_id,owner_id)) into allowed;
   when 'tasks' then select exists(select 1 from public.crm_tasks where id=record_id and public.crm_can_access(organization_id,owner_id)) into allowed;
   when 'invoices' then select exists(select 1 from public.crm_invoices where id=record_id and public.crm_can_access(organization_id,owner_id)) into allowed;
   else return false;
  end case;
  if not allowed then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function public.ca_context_visible(uuid,jsonb) from public,anon;
grant execute on function public.ca_context_visible(uuid,jsonb) to authenticated;
alter policy ca_job_read on public.ca_agent_jobs using(
 organization_id=(select public.current_organization_id())
 and ((select public.has_portal_role(array['admin','partner']::public.portal_role[]))
  or (created_by=(select auth.uid()) and public.ca_context_visible(organization_id,sources)
   and (client_id is null or exists(select 1 from public.crm_clients c where c.id=client_id and public.crm_can_access(c.organization_id,c.owner_id)))))
);
create function public.ca_require_creator()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
 if new.state='running' and new.created_by is distinct from auth.uid() then raise exception 'Only the workpaper creator can prepare its draft'; end if;
 return new;
end $$;
revoke all on function public.ca_require_creator() from public,anon,authenticated;
create trigger ca_run_creator before update of state on public.ca_agent_jobs for each row execute function public.ca_require_creator();
