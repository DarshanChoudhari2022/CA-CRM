-- Explicit administrator cancellations remain cancelled on repeated schedules.
create or replace function public.crm_schedule_dispatch(p_org uuid,p_now timestamptz default now())
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
 -- Reconsider only this eligible compliance occurrence. Even automatic organizations
 -- require fresh approval. Provider/lease evidence may represent a previous send.
 on conflict(organization_id,source_module,source_id,occurrence,channel) do update
 set status='review',recipient=excluded.recipient,subject=excluded.subject,body=excluded.body,
  source_due_date=excluded.source_due_date,error=null,updated_at=now()
 where crm_dispatch.source_module='compliance' and crm_dispatch.status='cancelled'
  and crm_dispatch.provider_id is null and crm_dispatch.lease is null
  and not exists(select 1 from public.audit_logs a where a.organization_id=crm_dispatch.organization_id
   and a.action='dispatch_cancelled' and a.entity_type='dispatch' and a.entity_id=crm_dispatch.id::text);
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.crm_schedule_dispatch(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_schedule_dispatch(uuid,timestamptz) to service_role;
