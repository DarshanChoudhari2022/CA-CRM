create table public.billing_advances (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 client_id uuid not null references public.crm_clients(id),
 received_on date not null,
 amount numeric(12,2) not null check(amount>0),
 remaining numeric(12,2) not null check(remaining>=0 and remaining<=amount),
 mode text not null check(mode in ('NEFT','RTGS','IMPS','UPI','Cheque','Cash','Other')),
 reference text not null,
 remarks text not null,
 unique(organization_id,reference)
);
create index billing_advances_client_date on public.billing_advances(organization_id,client_id,received_on desc,id);
create table public.billing_advance_allocations (
 organization_id uuid not null references public.organizations(id),
 request_id uuid not null,
 advance_id uuid not null references public.billing_advances(id),
 invoice_id uuid not null references public.crm_invoices(id),
 payment_id uuid not null unique references public.crm_payments(id),
 amount numeric(12,2) not null,
 primary key(organization_id,request_id)
);
alter table public.billing_advances enable row level security;
alter table public.billing_advance_allocations enable row level security;
revoke all on public.billing_advances,public.billing_advance_allocations from public,anon,authenticated;
grant select on public.billing_advances to authenticated;
create policy billing_advances_admin_read on public.billing_advances for select to authenticated
 using(public.crm_can_access(organization_id,null));

create function public.billing_record_advance(p_client uuid,p_date date,p_amount numeric,p_mode text,p_reference text,p_remarks text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); saved uuid; zone text;
begin
 perform public.assert_admin();
 select timezone into zone from public.organizations where id=org;
 if p_date is null or p_date>(now() at time zone zone)::date or p_amount is null
  or p_amount not between 0.01 and 9999999999.99 or p_amount<>round(p_amount,2)
  or p_reference is null or length(trim(p_reference)) not between 3 and 100
  or length(coalesce(p_remarks,''))>150 then raise exception 'Check the advance payment details'; end if;
 if not exists(select 1 from public.crm_clients where id=p_client and organization_id=org and status='active')
 then raise exception 'Choose an active client'; end if;
 insert into public.billing_advances(organization_id,client_id,received_on,amount,remaining,mode,reference,remarks)
 values(org,p_client,p_date,p_amount,p_amount,p_mode,trim(p_reference),coalesce(p_remarks,'')) returning id into saved;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(org,auth.uid(),'advance_received','billing_advances',saved::text,jsonb_build_object('amount',p_amount));
 return saved;
end $$;

create function public.billing_apply_advance(p_advance uuid,p_invoice uuid,p_amount numeric,p_request uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); advance public.billing_advances; allocation public.billing_advance_allocations; payment uuid;
begin
 perform public.assert_admin();
 if p_request is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2)
 then raise exception 'Enter a valid allocation amount'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||':advance-allocation:'||p_request::text,0));
 select * into allocation from public.billing_advance_allocations where organization_id=org and request_id=p_request;
 if found then
  if (allocation.advance_id,allocation.invoice_id,allocation.amount) is distinct from (p_advance,p_invoice,p_amount)
  then raise exception 'This allocation request was already used'; end if;
  return allocation.payment_id;
 end if;
 select * into advance from public.billing_advances where id=p_advance and organization_id=org for update;
 if not found or advance.remaining<p_amount then raise exception 'The advance does not have enough remaining balance'; end if;
 perform 1 from public.crm_invoices where id=p_invoice and organization_id=org and client_id=advance.client_id for update;
 if not found then raise exception 'Choose an invoice for the same client'; end if;
 payment:=public.billing_record_receipt(p_invoice,p_amount,'ADV:'||p_request::text);
 update public.billing_advances set remaining=remaining-p_amount where id=advance.id;
 insert into public.billing_advance_allocations values(org,p_request,advance.id,p_invoice,payment,p_amount);
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(org,auth.uid(),'advance_allocated','billing_advances',advance.id::text,p_request,
  jsonb_build_object('invoice',p_invoice,'payment',payment,'amount',p_amount));
 return payment;
end $$;
revoke all on function public.billing_record_advance(uuid,date,numeric,text,text,text),public.billing_apply_advance(uuid,uuid,numeric,uuid) from public,anon;
grant execute on function public.billing_record_advance(uuid,date,numeric,text,text,text),public.billing_apply_advance(uuid,uuid,numeric,uuid) to authenticated;

create function public.billing_client_totals(p_client uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare org uuid:=public.current_organization_id(); result jsonb;
begin
 perform public.assert_admin();
 if p_client is null or p_from>p_to or not exists(select 1 from public.crm_clients where id=p_client and organization_id=org)
 then raise exception 'Client or date range unavailable'; end if;
 select jsonb_build_object('billed',coalesce(sum(amount),0),'received',coalesce(sum(received),0),
  'outstanding',coalesce(sum(balance),0),'unapplied',(
   select coalesce(sum(remaining),0) from public.billing_advances where organization_id=org and client_id=p_client
  )) into result from public.billing_invoice_rows(p_from,p_to,p_client) where status not in ('draft','cancelled');
 return result;
end $$;
revoke all on function public.billing_client_totals(uuid,date,date) from public,anon;
grant execute on function public.billing_client_totals(uuid,date,date) to authenticated;
