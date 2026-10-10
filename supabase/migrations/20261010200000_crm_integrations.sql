create table public.crm_outbox (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 source_id uuid not null references public.crm_support(id), actor_user_id uuid not null references auth.users(id),
 channel text not null check(channel in ('gmail','whatsapp')), recipient text not null,
 subject text not null, body text not null, status text not null default 'sending' check(status in ('sending','accepted','uncertain')),
 provider_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.crm_outbox enable row level security;
create policy crm_outbox_read on public.crm_outbox for select to authenticated using(organization_id=public.current_organization_id() and public.has_portal_role(array['admin','partner']::public.portal_role[]));
grant select on public.crm_outbox to authenticated;
create index crm_outbox_org_time on public.crm_outbox(organization_id,created_at);

create function public.crm_reserve_send(p_id uuid,p_source uuid,p_channel text,p_recipient text,p_subject text,p_body text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare org uuid := public.current_organization_id();
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) then raise exception 'Administrator required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||':outbound',0));
 if exists(select 1 from public.crm_outbox where id=p_id) then raise exception 'This request was already submitted. Check the outbox before resending.'; end if;
 if not exists(select 1 from public.crm_support where id=p_source and organization_id=org) then raise exception 'Support record unavailable'; end if;
 if (select count(*) from public.crm_outbox where organization_id=org and created_at>now()-interval '1 hour')>=20 then raise exception 'Hourly message limit reached'; end if;
 if p_channel not in ('gmail','whatsapp') or length(p_body) not between 1 and 4000 or length(p_subject) not between 1 and 160 or length(p_recipient) not between 3 and 320 then raise exception 'Invalid message'; end if;
 insert into public.crm_outbox(id,organization_id,source_id,actor_user_id,channel,recipient,subject,body) values(p_id,org,p_source,auth.uid(),p_channel,p_recipient,p_subject,p_body);
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(org,auth.uid(),'outbound_requested','support',p_source::text,p_id);
 return p_id;
end $$;
revoke all on function public.crm_reserve_send(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.crm_reserve_send(uuid,uuid,text,text,text,text) to authenticated;

create function public.crm_acknowledge_event(p_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.crm_automation_events;
begin
 select * into e from public.crm_automation_events where id=p_id for update;
 if e.id is null or not coalesce(public.crm_can_access(e.organization_id,e.owner_id),false) then raise exception 'Event unavailable'; end if;
 update public.crm_automation_events set status='acknowledged' where id=e.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(e.organization_id,auth.uid(),'reminder_acknowledged','automation',e.id::text,gen_random_uuid());
end $$;
revoke all on function public.crm_acknowledge_event(uuid) from public,anon;
grant execute on function public.crm_acknowledge_event(uuid) to authenticated;

create function public.crm_reserve_draft(p_source uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare t public.crm_support; org uuid := public.current_organization_id();
begin
 select * into t from public.crm_support where id=p_source;
 if t.id is null or not coalesce(public.crm_can_access(t.organization_id,t.owner_id),false) then raise exception 'Support record unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||':ai',0));
 if (select count(*) from public.audit_logs where organization_id=org and action='ai_draft_requested' and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly AI draft limit reached'; end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(org,auth.uid(),'ai_draft_requested','support',p_source::text,gen_random_uuid());
end $$;
revoke all on function public.crm_reserve_draft(uuid) from public,anon;
grant execute on function public.crm_reserve_draft(uuid) to authenticated;

-- Financial records cannot be moved back to draft to change issued amounts.
create function public.crm_invoice_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if old.status in ('issued','void') and (new.amount<>old.amount or new.client_id<>old.client_id or new.status='draft') then raise exception 'Issued invoice amounts and clients are immutable'; end if;
 if new.status='void' and exists(select 1 from public.crm_payments where invoice_id=old.id) then raise exception 'Paid invoice cannot be voided'; end if;
 return new;
end $$;
create trigger crm_invoice_guard before update on public.crm_invoices for each row execute function public.crm_invoice_guard();
