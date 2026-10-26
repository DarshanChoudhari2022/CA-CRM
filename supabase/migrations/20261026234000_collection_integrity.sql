-- Deleting an unfinished reservation must release the FK without making its
-- collection token reusable. Retained versions are never discard candidates.
alter table public.crm_collection_links
 drop constraint crm_collection_links_version_id_fkey,
 add constraint crm_collection_links_version_id_fkey
 foreign key (version_id) references public.crm_document_versions(id) on delete set null;

create function public.crm_collection_version_deleted()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.state='ready' then raise exception 'Retained versions cannot be discarded'; end if;
 update public.crm_collection_links
 set expires_at=least(expires_at,now()-interval '1 second')
 where version_id=old.id and completed_at is null;
 return old;
end $$;
revoke all on function public.crm_collection_version_deleted() from public,anon,authenticated;
create trigger crm_collection_version_deleted before delete on public.crm_document_versions
 for each row execute function public.crm_collection_version_deleted();

create or replace function public.crm_collection_reserve(p_hash text,p_name text,p_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l public.crm_collection_links; d public.crm_documents; v public.crm_document_versions; next_version int; v_id uuid:=gen_random_uuid();
begin
 -- Read only to discover the document. All mutations serialize on document ->
 -- link -> version, matching staff finish/discard's document -> version order.
 select * into l from public.crm_collection_links where token_hash=p_hash;
 if l.token_hash is null then raise exception 'Upload link expired or already used'; end if;
 select * into d from public.crm_documents where id=l.document_id and organization_id=l.organization_id for update;
 select * into l from public.crm_collection_links where token_hash=p_hash for update;
 if l.token_hash is null or l.expires_at<now() or l.completed_at is not null then raise exception 'Upload link expired or already used'; end if;
 if d.id is null or l.document_id<>d.id or l.organization_id<>d.organization_id or d.status not in ('requested','rejected') then raise exception 'Document is no longer awaiting upload'; end if;
 if p_size is null or p_size not between 1 and 10485760 or p_name is null or length(p_name) not between 1 and 160 or p_type is null or p_type not in ('application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then raise exception 'Invalid file'; end if;
 if l.version_id is not null then
  select * into v from public.crm_document_versions where id=l.version_id for update;
  if v.id is null or v.document_id<>d.id or v.organization_id<>d.organization_id or v.state<>'pending' then raise exception 'Upload is not pending or is being discarded'; end if;
  if v.filename<>p_name or v.byte_size<>p_size or v.content_type<>p_type then raise exception 'Retry with the same file'; end if;
  return jsonb_build_object('id',v.id,'path',v.storage_path);
 end if;
 select coalesce(max(version),0)+1 into next_version from public.crm_document_versions where document_id=d.id;
 if (select count(*) from public.crm_document_versions where document_id=d.id)>=10 then raise exception 'Document version limit reached'; end if;
 insert into public.crm_document_versions(id,organization_id,document_id,version,filename,content_type,byte_size,storage_path)
 values(v_id,l.organization_id,d.id,next_version,p_name,p_type,p_size,l.organization_id::text||'/'||d.id::text||'/'||v_id::text) returning * into v;
 update public.crm_collection_links set version_id=v.id where token_hash=p_hash;
 return jsonb_build_object('id',v.id,'path',v.storage_path);
end $$;

create or replace function public.crm_collection_finish(p_hash text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare l public.crm_collection_links; d public.crm_documents; v public.crm_document_versions;
begin
 select * into l from public.crm_collection_links where token_hash=p_hash;
 if l.token_hash is null then raise exception 'Invalid link'; end if;
 select * into d from public.crm_documents where id=l.document_id and organization_id=l.organization_id for update;
 select * into l from public.crm_collection_links where token_hash=p_hash for update;
 if l.token_hash is null or l.expires_at<now() then raise exception 'Invalid link'; end if;
 -- Successful retries must not overwrite later staff review or duplicate audit.
 if l.completed_at is not null then return; end if;
 if d.id is null or l.document_id<>d.id or l.organization_id<>d.organization_id or d.status not in ('requested','rejected') then raise exception 'Document is no longer awaiting upload'; end if;
 select * into v from public.crm_document_versions where id=l.version_id for update;
 if v.id is null or v.document_id<>d.id or v.organization_id<>d.organization_id or v.state<>'pending' then raise exception 'Upload is not pending or is being discarded'; end if;
 if not exists(select 1 from storage.objects where bucket_id='crm-documents' and name=v.storage_path and metadata->>'mimetype'=v.content_type and (metadata->>'size')::bigint=v.byte_size) then raise exception 'Upload not complete'; end if;
 update public.crm_document_versions set state='ready' where id=v.id;
 update public.crm_documents set storage_path=v.storage_path,status='received',updated_at=now() where id=d.id
 and not exists(select 1 from public.crm_document_versions where document_id=d.id and state='ready' and version>v.version);
 update public.crm_collection_links set completed_at=now() where token_hash=p_hash;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,request_id,metadata)
 values(l.organization_id,'client_document_received','document',d.id::text,v.id,jsonb_build_object('version',v.version));
end $$;

revoke all on function public.crm_collection_reserve(text,text,text,integer),public.crm_collection_finish(text) from public,anon,authenticated;
grant execute on function public.crm_collection_reserve(text,text,text,integer),public.crm_collection_finish(text) to service_role;
