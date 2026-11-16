create index if not exists billing_invoice_org_created on public.crm_invoices(organization_id,created_at desc,id desc);
create index if not exists billing_invoice_payment_lookup on public.crm_payments(invoice_id);

create function public.billing_invoice_rows(p_from date,p_to date,p_client uuid)
returns table(id uuid,invoice_number text,client_id uuid,client_name text,invoice_date date,due_date date,
 created_at timestamptz,amount numeric,received numeric,balance numeric,status text)
language sql stable security definer set search_path=public,auth as $$
 select i.id,coalesce(nullif(i.invoice_details->>'reference',''),i.invoice_number),i.client_id,c.title,
  coalesce((i.invoice_details->>'invoiceDate')::date,(i.created_at at time zone o.timezone)::date),
  i.due_date,i.created_at,i.amount,p.received,
  case when i.status='issued' then greatest(0,i.amount-p.received) else 0 end,
  case when i.status='draft' then 'draft' when i.status='void' then 'cancelled'
       when p.received>=i.amount then 'paid' when p.received>0 then 'partial' else 'unpaid' end
 from public.crm_invoices i join public.crm_clients c on c.id=i.client_id and c.organization_id=i.organization_id
 join public.organizations o on o.id=i.organization_id
 cross join lateral (select coalesce(sum(amount),0) received from public.crm_payments
   where invoice_id=i.id and organization_id=i.organization_id) p
 where i.organization_id=public.current_organization_id()
 and (p_client is null or i.client_id=p_client)
 and (p_from is null or coalesce((i.invoice_details->>'invoiceDate')::date,(i.created_at at time zone o.timezone)::date)>=p_from)
 and (p_to is null or coalesce((i.invoice_details->>'invoiceDate')::date,(i.created_at at time zone o.timezone)::date)<=p_to)
 and coalesce(i.invoice_details->>'documentType','invoice')='invoice'
 and public.has_portal_role(array['admin','partner']::public.portal_role[]);
$$;
revoke all on function public.billing_invoice_rows(date,date,uuid) from public,anon,authenticated;

create function public.billing_invoice_ledger(p_status text,p_client uuid,p_search text,p_from date,p_to date,p_page int,p_limit int)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare response jsonb;
begin
 perform public.assert_admin();
 if p_status is null or p_status not in ('all','draft','cancelled','paid','partial','unpaid')
  or p_page is null or p_page not between 1 and 100000 or p_limit is null or p_limit not between 1 and 5000
  or length(coalesce(p_search,''))>100 or p_from>p_to then raise exception 'Invalid ledger filters'; end if;
 with filtered as (
  select * from public.billing_invoice_rows(p_from,p_to,p_client) r
  where (p_status='all' or r.status=p_status)
    and (coalesce(p_search,'')='' or strpos(lower(r.invoice_number),lower(p_search))>0
     or strpos(lower(r.client_name),lower(p_search))>0 or strpos(r.amount::text,p_search)>0)
 ), page as (
  select * from filtered order by invoice_date desc,created_at desc,id desc limit p_limit offset ((p_page-1)*p_limit)
 ) select jsonb_build_object('total',(select count(*) from filtered),'rows',
   coalesce((select jsonb_agg(to_jsonb(page) order by invoice_date desc,created_at desc,id desc) from page),'[]'::jsonb))
 into response;
 return response;
end $$;

create function public.billing_invoice_dashboard(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare response jsonb;
begin
 perform public.assert_admin();
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>370
 then raise exception 'Choose a period of up to one year'; end if;
 with invoices as (
  select * from public.billing_invoice_rows(p_from,p_to,null)
  where status not in ('draft','cancelled')
 ), monthly as (
  select date_trunc('month',invoice_date)::date as month_start,sum(amount) billed,sum(received) collected from invoices group by 1
 ), months as (
  select series::date as month_start from generate_series(date_trunc('month',p_from),date_trunc('month',p_to),'1 month') series
 ) select jsonb_build_object('count',count(*),'billed',coalesce(sum(amount),0),
  'collected',coalesce(sum(received),0),'outstanding',coalesce(sum(balance),0),'average',coalesce(round(avg(amount),2),0),
  'trend',(select jsonb_agg(jsonb_build_object('month',m.month_start,'billed',coalesce(b.billed,0),
  'collected',coalesce(b.collected,0)) order by m.month_start) from months m left join monthly b using(month_start)))
 into response from invoices;
 return response;
end $$;

revoke all on function public.billing_invoice_ledger(text,uuid,text,date,date,int,int),public.billing_invoice_dashboard(date,date)
 from public,anon;
grant execute on function public.billing_invoice_ledger(text,uuid,text,date,date,int,int),public.billing_invoice_dashboard(date,date)
 to authenticated;

create function public.billing_cancel_invoice(p_invoice uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id();
begin
 perform public.assert_admin();
 if p_reason is null or length(trim(p_reason)) not between 3 and 250 then raise exception 'Enter a cancellation reason'; end if;
 update public.crm_invoices set status='void',updated_at=now()
 where id=p_invoice and organization_id=org and status='issued'
   and coalesce(invoice_details->>'documentType','invoice')='invoice';
 if not found then raise exception 'Only an issued invoice can be cancelled'; end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(org,auth.uid(),'invoice_cancelled','crm_invoices',p_invoice::text,jsonb_build_object('reason',trim(p_reason)));
end $$;
revoke all on function public.billing_cancel_invoice(uuid,text) from public,anon;
grant execute on function public.billing_cancel_invoice(uuid,text) to authenticated;
