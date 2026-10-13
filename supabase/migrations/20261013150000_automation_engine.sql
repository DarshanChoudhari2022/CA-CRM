-- Durable automation state. No external sends occur in database triggers.
create table public.crm_automation_settings (
 organization_id uuid primary key references public.organizations(id),
 enabled boolean not null default false, automatic_sends boolean not null default false, automatic_ai boolean not null default false,
 knowledge text not null default '' check(length(knowledge)<=12000),
 updated_at timestamptz not null default now()
);
create table public.crm_channel_permissions (
 organization_id uuid not null references public.organizations(id), channel text not null check(channel in ('gmail','whatsapp')),
 recipient text not null, allowed boolean not null default false, evidence text not null check(length(evidence) between 3 and 500),
 updated_at timestamptz not null default now(), primary key(organization_id,channel,recipient)
);
create table public.crm_inbound (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 channel text not null check(channel in ('website','gmail','whatsapp')), external_id text not null,
 sender text not null, name text not null default '', body text not null check(length(body) between 1 and 12000),
 status text not null default 'pending' check(status in ('pending','processing','review','complete','failed')),
 reply text not null default '', classification text, client_id uuid references public.crm_clients(id),
 lead_id uuid references public.crm_leads(id), support_id uuid references public.crm_support(id),
 attempts integer not null default 0, lease uuid, updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(), unique(organization_id,channel,external_id)
);
create table public.crm_dispatch (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 source_module text not null check(source_module in ('documents','compliance','leads','invoices','inbound','receipt','alert')),
 source_id uuid not null, occurrence text not null, source_due_date date, channel text not null check(channel in ('gmail','whatsapp','telegram')),
 recipient text not null, subject text not null, body text not null,
 status text not null default 'review' check(status in ('review','queued','sending','accepted','delivered','read','failed','uncertain','cancelled')),
 provider_id text, error text, lease uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,source_module,source_id,occurrence,channel)
);
create index dispatch_queue on public.crm_dispatch(organization_id,status,created_at);
create index inbound_queue on public.crm_inbound(organization_id,status,created_at);
create index dispatch_source_history on public.crm_dispatch(source_module,source_id,created_at);
create index inbound_sender_history on public.crm_inbound(organization_id,channel,sender,created_at desc);
create index dispatch_hourly_guard on public.crm_dispatch(organization_id,updated_at);
do $$ declare t text; begin
 foreach t in array array['crm_automation_settings','crm_channel_permissions','crm_inbound','crm_dispatch'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy automation_admin_read on public.%I for select to authenticated using(organization_id=public.current_organization_id() and public.has_portal_role(array[''admin'',''partner'']::public.portal_role[]))',t);
 end loop;
end $$;

create function public.crm_automation_config(p_enabled boolean,p_automatic boolean,p_knowledge text,p_ai boolean default false)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if not coalesce(public.has_portal_role(array['admin','partner']::public.portal_role[]),false) then raise exception 'Administrator required'; end if;
 if p_ai and length(trim(p_knowledge))<30 then raise exception 'Approved support knowledge required for automatic AI replies'; end if;
 insert into public.crm_automation_settings(organization_id,enabled,automatic_sends,knowledge,automatic_ai)
 values(public.current_organization_id(),p_enabled,p_automatic,p_knowledge,p_ai)
 on conflict(organization_id) do update set enabled=excluded.enabled,automatic_sends=excluded.automatic_sends,knowledge=excluded.knowledge,automatic_ai=excluded.automatic_ai,updated_at=now();
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
 values(public.current_organization_id(),auth.uid(),'automation_configured','automation',public.current_organization_id()::text,gen_random_uuid());
end $$;
create function public.crm_channel_permission(p_channel text,p_recipient text,p_allowed boolean,p_evidence text)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if not coalesce(public.has_portal_role(array['admin','partner']::public.portal_role[]),false) then raise exception 'Administrator required'; end if;
 if length(p_recipient) not between 3 and 320 or p_recipient ~ E'[\r\n]' then raise exception 'Invalid recipient'; end if;
 insert into public.crm_channel_permissions(organization_id,channel,recipient,allowed,evidence)
 values(public.current_organization_id(),p_channel,lower(trim(p_recipient)),p_allowed,p_evidence)
 on conflict(organization_id,channel,recipient) do update set allowed=excluded.allowed,evidence=excluded.evidence,updated_at=now();
end $$;
create function public.crm_dispatch_review(p_id uuid,p_send boolean,p_body text)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if not coalesce(public.has_portal_role(array['admin','partner']::public.portal_role[]),false) then raise exception 'Administrator required'; end if;
 if p_send and length(trim(p_body)) not between 1 and 4000 then raise exception 'Message required'; end if;
 update public.crm_dispatch set status=case when p_send then 'queued' else 'cancelled' end,
 body=case when p_send then p_body else body end,updated_at=now()
 where id=p_id and organization_id=public.current_organization_id() and status='review';
 if not found then raise exception 'Message unavailable or already processed'; end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
 values(public.current_organization_id(),auth.uid(),case when p_send then 'dispatch_approved' else 'dispatch_cancelled' end,'dispatch',p_id::text,gen_random_uuid());
end $$;
revoke all on function public.crm_automation_config(boolean,boolean,text,boolean),public.crm_channel_permission(text,text,boolean,text),public.crm_dispatch_review(uuid,boolean,text) from public,anon;
grant execute on function public.crm_automation_config(boolean,boolean,text,boolean),public.crm_channel_permission(text,text,boolean,text),public.crm_dispatch_review(uuid,boolean,text) to authenticated;

-- Intake is only callable by verified server adapters, never directly by anonymous clients.
create function public.crm_ingest(p_org uuid,p_channel text,p_external text,p_sender text,p_name text,p_body text,p_phone text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; c uuid; l uuid; s uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':intake',0));
 select id into result from public.crm_inbound where organization_id=p_org and channel=p_channel and external_id=p_external;
 if result is not null then return result; end if;
 if not exists(select 1 from public.crm_automation_settings where organization_id=p_org and enabled) then raise exception 'Automation paused'; end if;
 if length(p_external) not between 1 and 300 or length(p_sender) not between 3 and 320 or length(p_name)>200 or length(p_body) not between 1 and 12000 then raise exception 'Invalid enquiry'; end if;
 if (select count(*) from public.crm_inbound where organization_id=p_org and created_at>now()-interval '1 hour')>=200 then raise exception 'Intake limit reached'; end if;
 -- Ambiguous contacts remain unlinked: no client data is exposed through a guessed match.
 select case when count(*)=1 then (array_agg(id))[1] end into c from public.crm_clients
 where organization_id=p_org and status='active' and
 ((p_channel='gmail' and lower(email)=lower(p_sender)) or (p_channel='whatsapp' and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_sender,'[^0-9]','','g')));
 if c is not null then
 insert into public.crm_support(organization_id,client_id,title,notes) values(p_org,c,left(p_body,160),left(p_body,4000)) returning id into s;
 else
 select id into l from public.crm_leads where organization_id=p_org and status not in ('won','lost') and
 ((p_channel in ('gmail','website') and lower(email)=lower(p_sender)) or (p_channel in ('whatsapp','website') and phone=p_sender)) order by created_at desc limit 1;
 if l is null then insert into public.crm_leads(organization_id,title,email,phone,notes,due_date)
 values(p_org,coalesce(nullif(p_name,''),left(p_sender,200)),case when p_channel in ('gmail','website') and p_sender like '%@%' then p_sender end,
 coalesce(p_phone,case when p_channel='whatsapp' or (p_channel='website' and p_sender like '+%') then p_sender end),left(p_body,4000),current_date+3) returning id into l; end if;
 end if;
 insert into public.crm_inbound(organization_id,channel,external_id,sender,name,body,client_id,lead_id,support_id)
 values(p_org,p_channel,p_external,p_sender,p_name,p_body,c,l,s) returning id into result;
 if p_channel='whatsapp' and lower(trim(p_body)) in ('stop','unsubscribe','cancel reminders') then
 insert into public.crm_channel_permissions(organization_id,channel,recipient,allowed,evidence)
 values(p_org,p_channel,lower(p_sender),false,'Recipient opted out by inbound message')
 on conflict(organization_id,channel,recipient) do update set allowed=false,evidence=excluded.evidence,updated_at=now();
 update public.crm_inbound set status='complete' where id=result;
 end if;
 return result;
end $$;

create function public.crm_claim_inbound(p_org uuid)
returns setof public.crm_inbound language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
 if not exists(select 1 from public.crm_automation_settings where organization_id=p_org and enabled) then return; end if;
 update public.crm_inbound set status=case when attempts>=3 then 'failed' else 'pending' end where organization_id=p_org and status='processing' and updated_at<now()-interval '5 minutes';
 select id into v from public.crm_inbound where organization_id=p_org and status='pending' order by created_at for update skip locked limit 1;
 return query update public.crm_inbound set status='processing',attempts=attempts+1,lease=gen_random_uuid(),updated_at=now() where id=v returning *;
end $$;

-- Re-evaluate operational records at dispatch, not only when the reminder was generated.
create function public.crm_dispatch_eligible(p public.crm_dispatch)
returns boolean language sql stable security definer set search_path=public as $$
 select case p.source_module
 when 'documents' then exists(select 1 from public.crm_documents where id=p.source_id and organization_id=p.organization_id and status in ('requested','rejected'))
 when 'compliance' then exists(select 1 from public.crm_compliance where id=p.source_id and organization_id=p.organization_id and status<>'filed' and due_date is not distinct from p.source_due_date)
 when 'leads' then exists(select 1 from public.crm_leads where id=p.source_id and organization_id=p.organization_id and status not in ('won','lost'))
 when 'invoices' then exists(select 1 from public.crm_invoices i where i.id=p.source_id and i.organization_id=p.organization_id and i.status='issued' and i.due_date is not distinct from p.source_due_date and i.amount>coalesce((select sum(amount) from public.crm_payments where invoice_id=i.id),0))
 else true end;
$$;
create function public.crm_claim_dispatch(p_org uuid,p_channels text[])
returns setof public.crm_dispatch language plpgsql security definer set search_path=public as $$
declare v uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':dispatch',0));
 if not exists(select 1 from public.crm_automation_settings where organization_id=p_org and enabled) then return; end if;
 update public.crm_dispatch set status='uncertain',error='Worker lease expired; verify provider before resending',updated_at=now()
 where organization_id=p_org and status='sending' and updated_at<now()-interval '5 minutes';
 update public.crm_dispatch d set status='cancelled',updated_at=now() where organization_id=p_org and status in ('review','queued') and not public.crm_dispatch_eligible(d);
 if (select count(*) from public.crm_dispatch where organization_id=p_org and status in ('sending','accepted','delivered','read','uncertain') and updated_at>now()-interval '1 hour')>=20 then return; end if;
 select d.id into v from public.crm_dispatch d where d.organization_id=p_org and d.status='queued' and d.channel=any(p_channels)
 and (d.channel='telegram' or exists(select 1 from public.crm_channel_permissions p where p.organization_id=d.organization_id and p.channel=d.channel and p.recipient=lower(d.recipient) and p.allowed))
 order by d.created_at for update skip locked limit 1;
 return query update public.crm_dispatch set status='sending',lease=gen_random_uuid(),updated_at=now() where id=v returning *;
end $$;
revoke all on function public.crm_ingest(uuid,text,text,text,text,text,text),public.crm_claim_inbound(uuid),public.crm_dispatch_eligible(public.crm_dispatch),public.crm_claim_dispatch(uuid,text[]) from public,anon,authenticated;
grant execute on function public.crm_ingest(uuid,text,text,text,text,text,text),public.crm_claim_inbound(uuid),public.crm_dispatch_eligible(public.crm_dispatch),public.crm_claim_dispatch(uuid,text[]) to service_role;

create function public.crm_schedule_dispatch(p_org uuid,p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=public as $$
declare today date; local_time time; auto boolean; n int;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':schedule',0));
 select (p_now at time zone o.timezone)::date,(p_now at time zone o.timezone)::time,s.automatic_sends into today,local_time,auto
 from public.organizations o join public.crm_automation_settings s on s.organization_id=o.id where o.id=p_org and s.enabled;
 if today is null then return 0; end if;
 update public.crm_leads l set status='lost',notes=left(notes||E'\nAutomatically closed after four follow-up cycles without progress.',4000),updated_at=now()
 where l.organization_id=p_org and l.status in ('new','contacted') and
 not exists(select 1 from public.crm_inbound m where m.lead_id=l.id and m.created_at>(select max(x.created_at) from public.crm_dispatch x where x.source_module='leads' and x.source_id=l.id and x.status in ('accepted','delivered','read'))) and
 (select count(distinct occurrence) from public.crm_dispatch x where x.source_module='leads' and x.source_id=l.id and x.status in ('accepted','delivered','read'))>=4
 and not exists(select 1 from public.crm_dispatch x where x.source_module='leads' and x.source_id=l.id and x.updated_at>now()-interval '3 days');
 with candidates as (
 select 'compliance'::text module,c.id,c.title,c.client_id,null::text email,null::text phone,c.due_date,
 'Please review the pending compliance task: '||c.title||'. Recorded due date: '||c.due_date||'. Please contact our team if you need help.' body
 from public.crm_compliance c where local_time>='09:00' and c.organization_id=p_org and c.status<>'filed' and (c.due_date-today in (7,3,1,0) or c.due_date<today)
 union all
 select 'documents',d.id,d.title,d.client_id,null,null,d.due_date,
 'Please send the requested document: '||d.title||'. Include its name in your reply. Our team will review it after receipt.'
 from public.crm_documents d where local_time>='09:30' and d.organization_id=p_org and d.status in ('requested','rejected') and not exists(
 select 1 from public.crm_dispatch x where x.organization_id=p_org and x.source_module='documents' and x.source_id=d.id and x.created_at>now()-interval '3 days')
 union all
 select 'leads',l.id,l.title,l.client_id,l.email,l.phone,l.due_date,
 'Following up on your enquiry. Please share the service you need, your business type and preferred timeline so our team can assist.'
 from public.crm_leads l where local_time>='10:00' and l.organization_id=p_org and l.status not in ('won','lost') and l.due_date<=today
 and (select count(distinct occurrence) from public.crm_dispatch x where x.source_module='leads' and x.source_id=l.id and x.status in ('accepted','delivered','read'))<4
 and not exists(select 1 from public.crm_dispatch x where x.source_module='leads' and x.source_id=l.id and x.created_at>now()-interval '3 days')
 union all
 select 'invoices',i.id,i.title,i.client_id,null,null,i.due_date,
 case when i.due_date<today-15 then 'Partner attention required. ' when i.due_date<today then 'Overdue payment reminder. ' else 'Upcoming payment reminder. ' end||'Invoice '||i.title||', due '||i.due_date||'. Our records show an outstanding balance. If you have already paid, please share the transaction reference for verification.'
 from public.crm_invoices i where local_time>='10:30' and i.organization_id=p_org and i.status='issued' and (i.due_date=today+3 or i.due_date<=today)
 and i.amount>coalesce((select sum(amount) from public.crm_payments where invoice_id=i.id),0)
 )
 insert into public.crm_dispatch(organization_id,source_module,source_id,occurrence,source_due_date,channel,recipient,subject,body,status)
 select p_org,r.module,r.id,today::text||'/'||coalesce(r.due_date::text,''),r.due_date,p.channel,p.recipient,left(r.title,160),r.body,case when auto then 'queued' else 'review' end
 from candidates r left join public.crm_clients c on c.id=r.client_id and c.organization_id=p_org and c.status='active'
 join public.crm_channel_permissions p on p.organization_id=p_org and p.allowed and
 ((p.channel='gmail' and p.recipient=lower(coalesce(r.email,c.email))) or (p.channel='whatsapp' and regexp_replace(p.recipient,'[^0-9]','','g')=regexp_replace(coalesce(r.phone,c.phone),'[^0-9]','','g')))
 where not exists(select 1 from public.crm_dispatch x where x.source_module=r.module and x.source_id=r.id and x.channel=p.channel and x.status in ('review','queued','sending','uncertain'))
 on conflict do nothing;
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.crm_schedule_dispatch(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_schedule_dispatch(uuid,timestamptz) to service_role;

create function public.crm_finish_inbound(p_id uuid,p_lease uuid,p_reply text,p_classification text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.crm_inbound; auto boolean;
begin
 select * into m from public.crm_inbound where id=p_id and lease=p_lease and status='processing' for update;
 if m.id is null then raise exception 'Stale processing lease'; end if;
 if length(trim(p_reply)) not between 1 and 4000 or p_classification not in ('general','qualified','urgent','needs_review') then raise exception 'Invalid AI result'; end if;
 select automatic_ai into auto from public.crm_automation_settings where organization_id=m.organization_id and enabled;
 update public.crm_inbound set status='review',reply=p_reply,classification=p_classification,updated_at=now() where id=m.id;
 if m.lead_id is not null then update public.crm_leads set notes=left(notes||E'\nAI qualification: '||p_classification,4000),
 status=case when status='new' and p_classification='qualified' then 'qualified' else status end,updated_at=now() where id=m.lead_id; end if;
 -- Only general knowledge replies can auto-send. Advice, urgent work and qualification remain reviewed.
 insert into public.crm_dispatch(organization_id,source_module,source_id,occurrence,channel,recipient,subject,body,status)
 values(m.organization_id,'inbound',m.id,'reply',case when m.channel='whatsapp' or (m.channel='website' and m.sender like '+%') then 'whatsapp' else 'gmail' end,m.sender,'Your enquiry · PSB & Associates',p_reply,
 case when auto and p_classification='general' and m.body not like 'Attachment requires%' then 'queued' else 'review' end) on conflict do nothing;
 if m.channel='website' and m.sender like '%@%' then
 insert into public.crm_dispatch(organization_id,source_module,source_id,occurrence,channel,recipient,subject,body,status)
 select m.organization_id,'inbound',m.id,'reply','whatsapp',phone,'Your enquiry · PSB & Associates',p_reply,
 case when auto and p_classification='general' then 'queued' else 'review' end from public.crm_leads where id=m.lead_id and phone is not null on conflict do nothing;
 end if;
end $$;
revoke all on function public.crm_finish_inbound(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_finish_inbound(uuid,uuid,text,text) to service_role;

create table public.crm_external_events (
 organization_id uuid not null references public.organizations(id),external_id text not null,kind text not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(organization_id,external_id)
);
alter table public.crm_external_events enable row level security;
revoke all on public.crm_external_events from public,anon,authenticated;
grant all on public.crm_external_events to service_role;
create function public.crm_external_update(p_org uuid,p_id text,p_kind text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.crm_external_events; c uuid; doc jsonb; ids jsonb:='[]'; v uuid; i public.crm_invoices; paid numeric; actor uuid; amount numeric; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':external',0));
 if not exists(select 1 from public.crm_automation_settings where organization_id=p_org and enabled) then raise exception 'Automation paused'; end if;
 if length(p_id) not between 1 and 200 then raise exception 'Event id required'; end if;
 select * into previous from public.crm_external_events where organization_id=p_org and external_id=p_id;
 if found then
 if previous.kind<>p_kind or previous.payload<>p_data then raise exception 'Event id was reused with different data'; end if;
 return previous.result;
 end if;
 if p_kind='documents' then
 c=(p_data->>'client_id')::uuid;
 if not exists(select 1 from public.crm_clients where id=c and organization_id=p_org and status='active') then raise exception 'Client unavailable'; end if;
 if jsonb_typeof(p_data->'documents')<>'array' or jsonb_array_length(p_data->'documents') not between 1 and 30 then raise exception 'Provide 1 to 30 documents'; end if;
 for doc in select * from jsonb_array_elements(p_data->'documents') loop
 if length(trim(doc->>'title')) not between 1 and 200 then raise exception 'Document title required'; end if;
 insert into public.crm_documents(organization_id,client_id,title,due_date,notes)
 values(p_org,c,doc->>'title',nullif(doc->>'due_date','')::date,coalesce(doc->>'notes','')) returning id into v;
 ids=ids||jsonb_build_array(v);
 end loop;
 result=jsonb_build_object('documents',ids);
 elsif p_kind='payment' then
 select * into i from public.crm_invoices where id=(p_data->>'invoice_id')::uuid and organization_id=p_org for update;
 amount=(p_data->>'amount')::numeric;
 if i.id is null or i.status<>'issued' or amount is null or amount<=0 or amount<>round(amount,2) then raise exception 'Invalid issued invoice or amount'; end if;
 select coalesce(sum(p.amount),0) into paid from public.crm_payments p where invoice_id=i.id;
 if amount+paid>i.amount then raise exception 'Payment exceeds outstanding balance'; end if;
 select user_id into actor from public.profiles where organization_id=p_org and active and role in ('admin','partner') order by user_id limit 1;
 if actor is null then raise exception 'Active finance administrator required'; end if;
 insert into public.crm_payments(organization_id,invoice_id,amount,reference,recorded_by)
 values(p_org,i.id,amount,'external:'||p_id,actor) returning id into v;
 result=jsonb_build_object('payment_id',v,'outstanding',i.amount-paid-amount);
 insert into public.crm_dispatch(organization_id,source_module,source_id,occurrence,channel,recipient,subject,body,status)
 select p_org,'receipt',v,p_id,p.channel,p.recipient,'Payment recorded · '||i.title,
 'We recorded a payment of INR '||amount||' against '||i.title||'. Outstanding: INR '||(i.amount-paid-amount)||'. Thank you.',
 case when s.automatic_sends then 'queued' else 'review' end
 from public.crm_clients c join public.crm_channel_permissions p on p.organization_id=c.organization_id and p.allowed
 and ((p.channel='gmail' and p.recipient=lower(c.email)) or (p.channel='whatsapp' and regexp_replace(p.recipient,'[^0-9]','','g')=regexp_replace(c.phone,'[^0-9]','','g')))
 join public.crm_automation_settings s on s.organization_id=c.organization_id where c.id=i.client_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(p_org,actor,'external_payment_recorded','invoice',i.id::text,v,jsonb_build_object('external_event',p_id,'amount',amount));
 else raise exception 'Unsupported event'; end if;
 insert into public.crm_external_events(organization_id,external_id,kind,payload,result) values(p_org,p_id,p_kind,p_data,result);
 return result;
end $$;
revoke all on function public.crm_external_update(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_external_update(uuid,text,text,jsonb) to service_role;

create table public.crm_collection_links (
 token_hash text primary key, organization_id uuid not null references public.organizations(id),
 document_id uuid not null references public.crm_documents(id), expires_at timestamptz not null,
 version_id uuid references public.crm_document_versions(id), completed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.crm_collection_links enable row level security;
revoke all on public.crm_collection_links from public,anon,authenticated;
grant all on public.crm_collection_links to service_role;
create function public.crm_collection_reserve(p_hash text,p_name text,p_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l public.crm_collection_links; d public.crm_documents; v public.crm_document_versions; next_version int; v_id uuid:=gen_random_uuid();
begin
 select * into l from public.crm_collection_links where token_hash=p_hash for update;
 if l.token_hash is null or l.expires_at<now() or l.completed_at is not null then raise exception 'Upload link expired or already used'; end if;
 select * into d from public.crm_documents where id=l.document_id and organization_id=l.organization_id for update;
 if d.id is null or d.status not in ('requested','rejected') then raise exception 'Document is no longer awaiting upload'; end if;
 if p_size not between 1 and 10485760 or length(p_name) not between 1 and 160 or p_type not in ('application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then raise exception 'Invalid file'; end if;
 if l.version_id is not null then
 select * into v from public.crm_document_versions where id=l.version_id;
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
create function public.crm_collection_finish(p_hash text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare l public.crm_collection_links; v public.crm_document_versions;
begin
 select * into l from public.crm_collection_links where token_hash=p_hash for update;
 if l.token_hash is null or l.expires_at<now() then raise exception 'Invalid link'; end if;
 if l.completed_at is not null then return; end if;
 select * into v from public.crm_document_versions where id=l.version_id for update;
 if v.id is null or not exists(select 1 from storage.objects where bucket_id='crm-documents' and name=v.storage_path and metadata->>'mimetype'=v.content_type and (metadata->>'size')::bigint=v.byte_size) then raise exception 'Upload not complete'; end if;
 update public.crm_document_versions set state='ready' where id=v.id;
 update public.crm_documents set storage_path=v.storage_path,status='received',updated_at=now() where id=l.document_id
 and not exists(select 1 from public.crm_document_versions where document_id=l.document_id and state='ready' and version>v.version);
 update public.crm_collection_links set completed_at=now() where token_hash=p_hash;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,request_id,metadata)
 values(l.organization_id,'client_document_received','document',l.document_id::text,v.id,jsonb_build_object('version',v.version));
end $$;
revoke all on function public.crm_collection_reserve(text,text,text,integer),public.crm_collection_finish(text) from public,anon,authenticated;
grant execute on function public.crm_collection_reserve(text,text,text,integer),public.crm_collection_finish(text) to service_role;

create table public.crm_automation_runs (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 started_at timestamptz not null default now(),finished_at timestamptz,status text not null default 'running',summary jsonb not null default '{}'
);
alter table public.crm_automation_runs enable row level security;
revoke all on public.crm_automation_runs from public,anon,authenticated;
grant select on public.crm_automation_runs to authenticated;
grant all on public.crm_automation_runs to service_role;
create policy automation_run_admin_read on public.crm_automation_runs for select to authenticated using(
 organization_id=public.current_organization_id() and public.has_portal_role(array['admin','partner']::public.portal_role[]));
create function public.crm_queue_partner_alerts(p_org uuid,p_recipient text)
returns void language plpgsql security definer set search_path=public as $$
declare today date; auto boolean;
begin
 select (now() at time zone o.timezone)::date,s.automatic_sends into today,auto from public.organizations o
 join public.crm_automation_settings s on s.organization_id=o.id where o.id=p_org and s.enabled;
 if today is null or p_recipient is null then return; end if;
 insert into public.crm_dispatch(organization_id,source_module,source_id,occurrence,channel,recipient,subject,body,status)
 select p_org,'alert',a.id,today::text,'telegram',p_recipient,'Partner attention required',a.message,case when auto then 'queued' else 'review' end from (
 select id,'Compliance overdue more than 3 days: '||title message from public.crm_compliance where organization_id=p_org and status<>'filed' and due_date<today-3
 union all select i.id,'Invoice overdue more than 15 days: '||i.title from public.crm_invoices i where i.organization_id=p_org and i.status='issued' and i.due_date<today-15 and i.amount>coalesce((select sum(amount) from public.crm_payments where invoice_id=i.id),0)
 union all select d.id,'Document still missing after repeated follow-ups: '||d.title from public.crm_documents d where d.organization_id=p_org and d.status in ('requested','rejected') and (select count(distinct occurrence) from public.crm_dispatch x where x.source_module='documents' and x.source_id=d.id and x.status in ('accepted','delivered','read'))>=3
 union all select id,'Urgent enquiry needs review. Open the CRM enquiry inbox.' from public.crm_inbound where organization_id=p_org and classification='urgent' and status<>'complete'
 ) a on conflict do nothing;
end $$;
revoke all on function public.crm_queue_partner_alerts(uuid,text) from public,anon,authenticated;
grant execute on function public.crm_queue_partner_alerts(uuid,text) to service_role;

create table public.crm_delivery_receipts (
 organization_id uuid not null references public.organizations(id),provider_id text not null,
 status text not null check(status in ('delivered','read','failed')),created_at timestamptz not null default now(),
 primary key(organization_id,provider_id,status)
);
alter table public.crm_delivery_receipts enable row level security;
revoke all on public.crm_delivery_receipts from public,anon,authenticated;
grant all on public.crm_delivery_receipts to service_role;
