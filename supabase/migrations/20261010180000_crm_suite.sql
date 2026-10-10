-- Module records share organization and employee ownership while keeping typed tables.
create table public.crm_clients (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), status text not null default 'active' check(status in ('active','inactive')),
 email text, phone text, notes text not null default '', owner_id uuid references public.employees(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_leads (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), status text not null default 'new' check(status in ('new','contacted','qualified','won','lost')),
 email text, phone text, due_date date, notes text not null default '', owner_id uuid references public.employees(id),
 client_id uuid references public.crm_clients(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_documents (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), status text not null default 'requested' check(status in ('requested','received','reviewed','rejected')),
 client_id uuid references public.crm_clients(id), owner_id uuid references public.employees(id), due_date date,
 storage_path text, notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_compliance (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), status text not null default 'pending' check(status in ('pending','in_progress','filed','blocked')),
 client_id uuid references public.crm_clients(id), owner_id uuid references public.employees(id), due_date date not null,
 notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_invoices (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), status text not null default 'draft' check(status in ('draft','issued','void')),
 client_id uuid not null references public.crm_clients(id), owner_id uuid references public.employees(id), due_date date,
 amount numeric(12,2) not null check(amount>0), notes text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_payments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 invoice_id uuid not null references public.crm_invoices(id), amount numeric(12,2) not null check(amount>0),
 reference text not null, recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(organization_id,reference)
);
create table public.crm_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), status text not null default 'todo' check(status in ('todo','in_progress','done','blocked')),
 client_id uuid references public.crm_clients(id), owner_id uuid references public.employees(id), due_date date,
 notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_support (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 200), status text not null default 'open' check(status in ('open','assigned','resolved','escalated')),
 client_id uuid references public.crm_clients(id), owner_id uuid references public.employees(id), due_date date,
 notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_automation_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null, status text not null default 'queued' check(status in ('queued','acknowledged')),
 source_module text not null, source_id uuid not null, owner_id uuid references public.employees(id),
 notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(source_module,source_id)
);

create function public.crm_can_access(p_org uuid,p_owner uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select p_org=public.current_organization_id() and (public.has_portal_role(array['admin','partner']::public.portal_role[])
 or (p_owner is not null and public.can_view_employee(p_owner)));
$$;
revoke all on function public.crm_can_access(uuid,uuid) from public,anon;
grant execute on function public.crm_can_access(uuid,uuid) to authenticated;

do $$ declare t text; begin
 foreach t in array array['crm_clients','crm_leads','crm_documents','crm_compliance','crm_invoices','crm_tasks','crm_support','crm_automation_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy crm_read on public.%I for select to authenticated using(public.crm_can_access(organization_id,owner_id))',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create index on public.%I(organization_id,owner_id)',t);
 end loop;
end $$;
alter table public.crm_payments enable row level security;
create policy payment_read on public.crm_payments for select to authenticated using(organization_id=public.current_organization_id() and exists(select 1 from public.crm_invoices i where i.id=invoice_id and public.crm_can_access(i.organization_id,i.owner_id)));
grant select on public.crm_payments to authenticated;

create function public.crm_save(p_module text,p_id uuid,p_values jsonb)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare t text; org uuid; v_id uuid; own uuid; client uuid; is_admin boolean; old_record jsonb; cols text; vals text;
begin
 org=public.current_organization_id();
 if org is null or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Active workspace access required'; end if;
 t=case p_module when 'clients' then 'crm_clients' when 'leads' then 'crm_leads' when 'documents' then 'crm_documents' when 'compliance' then 'crm_compliance' when 'invoices' then 'crm_invoices' when 'tasks' then 'crm_tasks' when 'support' then 'crm_support' end;
 if t is null then raise exception 'Unknown module'; end if;
 is_admin=public.has_portal_role(array['admin','partner']::public.portal_role[]);
 if not is_admin and p_id is null then raise exception 'Administrator creates records and assignments'; end if;
 if p_id is not null then
   execute format('select to_jsonb(r) from public.%I r where id=$1 and organization_id=$2 for update',t) into old_record using p_id,org;
   if old_record is null or not public.crm_can_access(org,(old_record->>'owner_id')::uuid) then raise exception 'Record unavailable'; end if;
 end if;
 own=nullif(p_values->>'owner_id','')::uuid;
 client=nullif(p_values->>'client_id','')::uuid;
 if not is_admin and (own is distinct from (old_record->>'owner_id')::uuid or client is distinct from (old_record->>'client_id')::uuid or p_module in ('clients','leads','invoices')) then raise exception 'Administrator required for this change'; end if;
 if own is not null and not exists(select 1 from public.employees where id=own and organization_id=org and active) then raise exception 'Invalid owner'; end if;
 if client is not null and not exists(select 1 from public.crm_clients where id=client and organization_id=org) then raise exception 'Invalid client'; end if;
 if length(trim(p_values->>'title')) not between 1 and 200 or length(coalesce(p_values->>'notes',''))>4000 then raise exception 'Invalid title or notes'; end if;
 if p_module='invoices' and old_record is not null and (old_record->>'status')<>'draft' and (p_values->>'amount')::numeric is distinct from (old_record->>'amount')::numeric then raise exception 'Issued invoice amount cannot change'; end if;
 cols='title,status,notes,owner_id'; vals='($1->>''title''),($1->>''status''),coalesce($1->>''notes'',''''),nullif($1->>''owner_id'','''')::uuid';
 if p_module in ('clients','leads') then cols=cols||',email,phone'; vals=vals||',nullif($1->>''email'',''''),nullif($1->>''phone'','''')'; end if;
 if p_module<>'clients' then cols=cols||',client_id,due_date'; vals=vals||',nullif($1->>''client_id'','''')::uuid,nullif($1->>''due_date'','''')::date'; end if;
 if p_module='invoices' then cols=cols||',amount'; vals=vals||',($1->>''amount'')::numeric'; end if;
 if p_id is null then
  execute format('insert into public.%I(organization_id,%s) select $2,%s returning id',t,cols,vals) into v_id using p_values,org;
 else
  execute format('update public.%I set (%s)=(select %s),updated_at=now() where id=$2 returning id',t,cols,vals) into v_id using p_values,p_id;
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(org,auth.uid(),case when p_id is null then 'record_created' else 'record_updated' end,t,v_id::text,gen_random_uuid(),jsonb_build_object('before',old_record,'after',p_values));
 return v_id;
end $$;
revoke all on function public.crm_save(text,uuid,jsonb) from public,anon;
grant execute on function public.crm_save(text,uuid,jsonb) to authenticated;

create function public.crm_record_payment(p_invoice uuid,p_amount numeric,p_reference text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare inv public.crm_invoices; total numeric; result uuid;
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) then raise exception 'Administrator required'; end if;
 select * into inv from public.crm_invoices where id=p_invoice and organization_id=public.current_organization_id() for update;
 if inv.id is null or inv.status<>'issued' then raise exception 'Only issued invoices accept payments'; end if;
 if p_amount<=0 or p_amount is null or length(trim(p_reference)) not between 3 and 120 then raise exception 'Invalid amount or payment reference'; end if;
 select coalesce(sum(amount),0) into total from public.crm_payments where invoice_id=inv.id;
 if total+p_amount>inv.amount then raise exception 'Payment exceeds outstanding amount'; end if;
 insert into public.crm_payments(organization_id,invoice_id,amount,reference,recorded_by) values(inv.organization_id,inv.id,p_amount,trim(p_reference),auth.uid()) returning id into result;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(inv.organization_id,auth.uid(),'payment_recorded','invoice',inv.id::text,gen_random_uuid());
 return result;
end $$;
revoke all on function public.crm_record_payment(uuid,numeric,text) from public,anon;
grant execute on function public.crm_record_payment(uuid,numeric,text) to authenticated;

create function public.crm_convert_lead(p_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare l public.crm_leads; c uuid;
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) then raise exception 'Administrator required'; end if;
 select * into l from public.crm_leads where id=p_id and organization_id=public.current_organization_id() for update;
 if l.id is null then raise exception 'Lead unavailable'; end if;
 if l.client_id is not null then return l.client_id; end if;
 insert into public.crm_clients(organization_id,title,email,phone,notes,owner_id) values(l.organization_id,l.title,l.email,l.phone,l.notes,l.owner_id) returning id into c;
 update public.crm_leads set status='won',client_id=c,updated_at=now() where id=l.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(l.organization_id,auth.uid(),'lead_converted','lead',l.id::text,gen_random_uuid());
 return c;
end $$;
revoke all on function public.crm_convert_lead(uuid) from public,anon;
grant execute on function public.crm_convert_lead(uuid) to authenticated;

create function public.crm_queue_reminders()
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.crm_automation_events(organization_id,title,source_module,source_id,owner_id,notes)
 select organization_id,'Compliance due: '||title,'compliance',id,owner_id,'Due '||due_date from public.crm_compliance where due_date<=current_date+7 and status not in ('filed')
 on conflict(source_module,source_id) do nothing;
 insert into public.crm_automation_events(organization_id,title,source_module,source_id,owner_id,notes)
 select organization_id,'Task due: '||title,'tasks',id,owner_id,'Due '||due_date from public.crm_tasks where due_date<=current_date and status<>'done'
 on conflict(source_module,source_id) do nothing;
end $$;
revoke all on function public.crm_queue_reminders() from public,anon,authenticated;
select cron.schedule('psb-crm-reminders','30 3 * * *','select public.crm_queue_reminders()');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-documents','crm-documents',false,10485760,array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) on conflict(id) do nothing;
create policy crm_document_upload on storage.objects for insert to authenticated with check(bucket_id='crm-documents' and (storage.foldername(name))[1]=public.current_organization_id()::text and exists(select 1 from public.crm_documents d where d.id::text=(storage.foldername(name))[2] and public.crm_can_access(d.organization_id,d.owner_id)));
create policy crm_document_read on storage.objects for select to authenticated using(bucket_id='crm-documents' and exists(select 1 from public.crm_documents d where d.storage_path=name and public.crm_can_access(d.organization_id,d.owner_id)));

create function public.crm_attach_document(p_id uuid,p_path text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare d public.crm_documents;
begin
 select * into d from public.crm_documents where id=p_id for update;
 if not public.crm_can_access(d.organization_id,d.owner_id) then raise exception 'Document unavailable'; end if;
 if p_path not like d.organization_id::text||'/'||d.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='crm-documents' and name=p_path) then raise exception 'Upload unavailable'; end if;
 update public.crm_documents set storage_path=p_path,status='received',updated_at=now() where id=d.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(d.organization_id,auth.uid(),'document_uploaded','document',d.id::text,gen_random_uuid());
end $$;
revoke all on function public.crm_attach_document(uuid,text) from public,anon;
grant execute on function public.crm_attach_document(uuid,text) to authenticated;
