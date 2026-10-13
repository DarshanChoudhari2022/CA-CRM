create table public.crm_document_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 document_id uuid not null references public.crm_documents(id), version integer not null check(version>0),
 filename text not null check(length(filename) between 1 and 160), content_type text not null,
 byte_size bigint not null check(byte_size between 1 and 10485760), storage_path text not null unique,
 state text not null default 'pending' check(state in ('pending','ready','discarding')),
 uploaded_by uuid references auth.users(id), created_at timestamptz not null default now(),
 unique(document_id,version)
);
alter table public.crm_document_versions enable row level security;
create policy document_version_read on public.crm_document_versions for select to authenticated using(
 organization_id=(select public.current_organization_id()) and exists(select 1 from public.crm_documents d
 where d.id=document_id and public.crm_can_access(d.organization_id,d.owner_id))
);
revoke all on public.crm_document_versions from public,anon,authenticated;
grant select on public.crm_document_versions to authenticated;
create index document_version_lookup on public.crm_document_versions(document_id,version desc);

-- Preserve the file currently linked by legacy records; no object or document is overwritten.
insert into public.crm_document_versions(organization_id,document_id,version,filename,content_type,byte_size,storage_path,state)
with candidates as (
 select d.organization_id,d.id document_id,d.storage_path current_path,o.name,o.metadata,o.created_at,
 row_number() over(partition by d.id order by (o.name=d.storage_path) desc,o.created_at desc,o.id) priority
 from public.crm_documents d join storage.objects o on o.bucket_id='crm-documents'
  and split_part(o.name,'/',1)=d.organization_id::text and split_part(o.name,'/',2)=d.id::text
 where (o.metadata->>'size') ~ '^[0-9]+$' and (o.metadata->>'size')::bigint between 1 and 10485760
), retained as (select *,row_number() over(partition by document_id order by created_at,name)::integer version from candidates where priority<=10)
select organization_id,document_id,version,left(split_part(name,'/',3),160),coalesce(metadata->>'mimetype','application/octet-stream'),
 (metadata->>'size')::bigint,name,case when name=current_path then 'ready' else 'pending' end from retained;
-- Legacy unlinked files are recovery candidates requiring admin finalization or discard, never auto-reviewed.

create function public.crm_reserve_document(p_id uuid,p_document uuid,p_filename text,p_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare d public.crm_documents; existing public.crm_document_versions; next_version int; path text;
begin
 select * into d from public.crm_documents where id=p_document for update;
 if d.id is null or not coalesce(public.crm_can_access(d.organization_id,d.owner_id),false) then raise exception 'Document unavailable'; end if;
 if p_id is null or p_filename is null or length(trim(p_filename)) not between 1 and 160 or p_size is null or p_size not between 1 and 10485760
 or p_type is null or p_type not in ('application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then raise exception 'Choose a supported file between 1 byte and 10 MB'; end if;
 select * into existing from public.crm_document_versions where id=p_id;
 if existing.id is not null then
  if existing.document_id<>d.id or existing.uploaded_by is distinct from auth.uid() or existing.filename<>trim(p_filename) or existing.content_type<>p_type or existing.byte_size<>p_size then raise exception 'Upload ID already used'; end if;
  return jsonb_build_object('id',existing.id,'path',existing.storage_path,'version',existing.version,'state',existing.state);
 end if;
 if (select count(*) from public.crm_document_versions where document_id=d.id)>=10 then raise exception 'Maximum 10 retained versions per document. Discard unfinished uploads to free a slot.'; end if;
 select coalesce(max(version),0)+1 into next_version from public.crm_document_versions where document_id=d.id;
 path:=d.organization_id::text||'/'||d.id::text||'/'||p_id::text;
 insert into public.crm_document_versions(id,organization_id,document_id,version,filename,content_type,byte_size,storage_path,uploaded_by)
 values(p_id,d.organization_id,d.id,next_version,trim(p_filename),p_type,p_size,path,auth.uid());
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(d.organization_id,auth.uid(),'document_upload_reserved','document',d.id::text,p_id,jsonb_build_object('version',next_version,'filename',trim(p_filename),'bytes',p_size));
 return jsonb_build_object('id',p_id,'path',path,'version',next_version,'state','pending');
end $$;

create function public.crm_finish_document(p_id uuid)
returns void language plpgsql security definer set search_path=public,storage,auth as $$
declare v public.crm_document_versions; d public.crm_documents;
begin
 select * into v from public.crm_document_versions where id=p_id;
 select * into d from public.crm_documents where id=v.document_id for update;
 if v.id is null or not coalesce(public.crm_can_access(d.organization_id,d.owner_id),false) or (v.uploaded_by is distinct from auth.uid() and not public.has_portal_role(array['admin','partner']::public.portal_role[])) then raise exception 'Upload unavailable'; end if;
 select * into v from public.crm_document_versions where id=p_id for update;
 if v.state='ready' then return; end if;
 if v.state<>'pending' then raise exception 'Upload is being discarded'; end if;
 if not exists(select 1 from storage.objects where bucket_id='crm-documents' and name=v.storage_path and metadata->>'mimetype'=v.content_type and (metadata->>'size')::bigint=v.byte_size) then raise exception 'Upload incomplete or metadata does not match'; end if;
 update public.crm_document_versions set state='ready' where id=v.id;
 -- Finishing an older upload late must not replace a newer completed version.
 if not exists(select 1 from public.crm_document_versions where document_id=d.id and state='ready' and version>v.version) then
  update public.crm_documents set storage_path=v.storage_path,status='received',updated_at=now() where id=d.id;
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(d.organization_id,auth.uid(),'document_version_received','document',d.id::text,v.id,jsonb_build_object('version',v.version));
end $$;

create function public.crm_discard_document(p_id uuid,p_complete boolean default false)
returns void language plpgsql security definer set search_path=public,storage,auth as $$
declare v public.crm_document_versions; d public.crm_documents;
begin
 select * into v from public.crm_document_versions where id=p_id;
 select * into d from public.crm_documents where id=v.document_id for update;
 if v.id is null or not coalesce(public.crm_can_access(d.organization_id,d.owner_id),false) or (v.uploaded_by is distinct from auth.uid() and not public.has_portal_role(array['admin','partner']::public.portal_role[])) then raise exception 'Upload unavailable'; end if;
 select * into v from public.crm_document_versions where id=p_id for update;
 if v.state='ready' then raise exception 'Retained versions cannot be discarded'; end if;
 if not p_complete then update public.crm_document_versions set state='discarding' where id=v.id;
 else
  if v.state<>'discarding' or exists(select 1 from storage.objects where bucket_id='crm-documents' and name=v.storage_path) then raise exception 'Remove the unfinished file before releasing the reservation'; end if;
  delete from public.crm_document_versions where id=v.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(v.organization_id,auth.uid(),'document_upload_discarded','document',v.document_id::text,v.id);
 end if;
end $$;

drop policy crm_document_upload on storage.objects;
drop policy crm_document_read on storage.objects;
create policy crm_document_upload on storage.objects for insert to authenticated with check(bucket_id='crm-documents' and exists(
 select 1 from public.crm_document_versions v join public.crm_documents d on d.id=v.document_id
 where v.storage_path=name and v.state='pending' and v.uploaded_by=auth.uid() and public.crm_can_access(d.organization_id,d.owner_id)));
create policy crm_document_read on storage.objects for select to authenticated using(bucket_id='crm-documents' and exists(
 select 1 from public.crm_document_versions v join public.crm_documents d on d.id=v.document_id where v.storage_path=name and public.crm_can_access(d.organization_id,d.owner_id)
 and (v.state='ready' or v.uploaded_by=auth.uid() or public.has_portal_role(array['admin','partner']::public.portal_role[])))
 -- Keep existing linked files readable if legacy metadata could not be backfilled.
 or bucket_id='crm-documents' and exists(select 1 from public.crm_documents d where d.storage_path=name and public.crm_can_access(d.organization_id,d.owner_id)));
create policy crm_document_discard on storage.objects for delete to authenticated using(bucket_id='crm-documents' and exists(
 select 1 from public.crm_document_versions v join public.crm_documents d on d.id=v.document_id where v.storage_path=name and v.state='discarding' and public.crm_can_access(d.organization_id,d.owner_id)
 and (v.uploaded_by=auth.uid() or public.has_portal_role(array['admin','partner']::public.portal_role[]))));

create or replace function public.crm_attach_document(p_id uuid,p_path text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare upload uuid;
begin
 select id into upload from public.crm_document_versions where document_id=p_id and storage_path=p_path;
 if upload is null then raise exception 'Reserve an upload before attaching it'; end if;
 perform public.crm_finish_document(upload);
end $$;
revoke all on function public.crm_reserve_document(uuid,uuid,text,text,integer),public.crm_finish_document(uuid),public.crm_discard_document(uuid,boolean) from public,anon;
grant execute on function public.crm_reserve_document(uuid,uuid,text,text,integer),public.crm_finish_document(uuid),public.crm_discard_document(uuid,boolean) to authenticated;
