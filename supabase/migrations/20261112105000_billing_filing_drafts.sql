create table public.billing_filing_drafts (
 organization_id uuid not null references public.organizations(id),
 filing_id uuid not null references public.crm_compliance(id),
 invoice_id uuid not null unique references public.crm_invoices(id),
 primary key(organization_id,filing_id)
);
alter table public.billing_filing_drafts enable row level security;
revoke all on public.billing_filing_drafts from public,anon,authenticated;

create function public.billing_generate_filing_draft(p_filing uuid,p_service uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare
 org uuid:=public.current_organization_id();
 filing public.crm_compliance;
 service public.billing_service_catalog;
 result uuid;
 invoice_day date;
 prefs jsonb;
begin
 perform public.assert_admin();
 select * into filing from public.crm_compliance where id=p_filing and organization_id=org for update;
 if not found or filing.status<>'filed' or filing.client_id is null then raise exception 'Choose a filed compliance record with a client'; end if;
 select invoice_id into result from public.billing_filing_drafts where organization_id=org and filing_id=filing.id;
 if found then return result; end if;
 if not exists(select 1 from public.crm_clients where organization_id=org and id=filing.client_id and status='active')
 then raise exception 'The filing client must be active'; end if;
 select * into service from public.billing_service_catalog where id=p_service and organization_id=org and active and unit_price>0;
 if not found then raise exception 'Choose an active service with a standard fee'; end if;
 select (now() at time zone timezone)::date into invoice_day from public.organizations where id=org;
 select settings into prefs from public.billing_practice_settings where organization_id=org and section='smart-drafts';
 result:=public.billing_save_invoice(null,gen_random_uuid(),null,jsonb_build_object(
   'title',left(coalesce(prefs->>'title_prefix','')||filing.title,200),'status','draft',
   'notes',left(concat_ws(chr(10),nullif(prefs->>'review_notes',''),
    'Draft generated from filed compliance record: '||filing.title||'. Review the fee and any applicable tax before issuing.'),4000),
   'client_id',filing.client_id,'amount',service.unit_price,
   'due_date',invoice_day+coalesce((prefs->>'payment_terms_days')::integer,7),
   'invoice_details',jsonb_build_object('template','modern','documentType','invoice','invoiceDate',invoice_day,
    'items',jsonb_build_array(jsonb_build_object('description',service.name,'details',service.description,
     'hsnSac',service.sac_code,'quantity',1,'rate',service.unit_price)))
 ));
 insert into public.billing_filing_drafts(organization_id,filing_id,invoice_id) values(org,filing.id,result);
 return result;
end $$;
revoke all on function public.billing_generate_filing_draft(uuid,uuid) from public,anon;
grant execute on function public.billing_generate_filing_draft(uuid,uuid) to authenticated;
