-- Billing can edit client details without modifying CRM ownership.
create function public.billing_update_client(
  p_id uuid, p_updated_at timestamptz, p_title text, p_status text,
  p_email text, p_phone text, p_notes text
)
returns void language plpgsql security definer set search_path=public,auth as $$
declare
  before_record public.crm_clients;
  after_record public.crm_clients;
  org uuid := public.current_organization_id();
begin
  if org is null or not public.has_portal_role(array['admin','partner']::public.portal_role[])
    or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then
    raise exception 'Administrator required';
  end if;
  if p_title is null or length(trim(p_title)) not between 1 and 200
    or p_status is null or p_status not in ('active','inactive')
    or length(coalesce(p_email,'')) > 254 or length(coalesce(p_phone,'')) > 40
    or length(coalesce(p_notes,'')) > 4000 then
    raise exception 'Check the client details';
  end if;

  select * into before_record from public.crm_clients
  where id=p_id and organization_id=org for update;
  if not found then raise exception 'Client unavailable'; end if;
  if before_record.updated_at is distinct from p_updated_at then
    raise exception 'This client changed since you opened it. Reload the client before saving.';
  end if;

  update public.crm_clients
  set title=trim(p_title), status=p_status, email=nullif(trim(p_email),''),
      phone=nullif(trim(p_phone),''), notes=coalesce(p_notes,''), updated_at=clock_timestamp()
  where id=p_id and organization_id=org returning * into after_record;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
  values(org,auth.uid(),'record_updated','crm_clients',p_id::text,gen_random_uuid(),
    jsonb_build_object('before',to_jsonb(before_record),'after',to_jsonb(after_record)));
end $$;

revoke all on function public.billing_update_client(uuid,timestamptz,text,text,text,text,text) from public,anon;
grant execute on function public.billing_update_client(uuid,timestamptz,text,text,text,text,text) to authenticated;

-- Legacy CRM can store quotations in crm_invoices. Lock and classify before delegating.
create function public.billing_record_receipt(p_invoice uuid, p_amount numeric, p_reference text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare
  org uuid := public.current_organization_id();
begin
  if not coalesce(public.crm_can_access(org,null),false) then raise exception 'Administrator required'; end if;

  perform 1 from public.crm_invoices
  where id=p_invoice and organization_id=org and status='issued'
    and coalesce(invoice_details->>'documentType','invoice')='invoice'
  for update;
  if not found then raise exception 'Only issued invoices accept payments'; end if;

  return public.crm_record_payment(p_invoice,p_amount,p_reference);
end $$;

revoke all on function public.billing_record_receipt(uuid,numeric,text) from public,anon;
grant execute on function public.billing_record_receipt(uuid,numeric,text) to authenticated;

create index billing_receipts_org_recorded on public.crm_payments(organization_id,created_at desc,id);

create function public.billing_receipt_total(p_invoice uuid)
returns numeric language sql stable security invoker set search_path=public as $$
  select coalesce(sum(p.amount),0)
  from public.crm_payments p
  where p.organization_id=public.current_organization_id()
    and public.crm_can_access(p.organization_id,null)
    and p.invoice_id=p_invoice;
$$;

revoke all on function public.billing_receipt_total(uuid) from public,anon;
grant execute on function public.billing_receipt_total(uuid) to authenticated;
