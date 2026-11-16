create function public.track_invoice_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
 before_values jsonb;
 after_values jsonb;
 operation text := current_setting('psb.invoice_change', true);
begin
 if coalesce(new.invoice_details->>'documentType','invoice') = 'quotation'
    and (tg_op = 'INSERT' or old.invoice_details->>'documentType' = 'quotation') then
  return new;
 end if;
 if tg_op = 'INSERT' then
  after_values := to_jsonb(new) - array['updated_at','billing_request_id'];
 else
  before_values := to_jsonb(old) - array['updated_at','billing_request_id'];
  after_values := to_jsonb(new) - array['updated_at','billing_request_id'];
  if before_values = after_values then return new; end if;
  if coalesce(operation, '') not in ('edit','delete','cancel') then
   raise exception 'Confirm your password in the Invoice Ledger.';
  end if;
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values (new.organization_id,auth.uid(),'invoice_history_' || coalesce(nullif(operation,''),'created'),
         'crm_invoices',new.id::text,jsonb_build_object('before',before_values,'after',after_values,
         'reason',nullif(current_setting('psb.invoice_reason',true),'')));
 return new;
end $$;
revoke all on function public.track_invoice_changes() from public, anon, authenticated;
create trigger track_invoice_changes after insert or update on public.crm_invoices
for each row execute function public.track_invoice_changes();
revoke delete on public.crm_invoices from authenticated, anon;

create function public.billing_confirmed_invoice_change(
 p_actor uuid, p_invoice uuid, p_action text, p_reason text default null,
 p_request uuid default null, p_version timestamptz default null, p_values jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
 invoice public.crm_invoices;
 org uuid;
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 perform public.assert_admin();
 org := public.current_organization_id();
 if not public.crm_can_access(org,null) or exists (
  select 1 from public.profiles where user_id=p_actor and password_change_required
 ) then raise exception 'Active administrator access required'; end if;
 select * into invoice from public.crm_invoices where id=p_invoice and organization_id=org for update;
 if not found then raise exception 'Invoice unavailable'; end if;
 perform set_config('psb.invoice_change',p_action,true);
 perform set_config('psb.invoice_reason',coalesce(trim(p_reason),''),true);
 if p_action='edit' then
  return public.billing_save_invoice(p_invoice,p_request,p_version,p_values);
 elsif p_action in ('delete','cancel') then
  if length(coalesce(trim(p_reason),'')) not between 3 and 250 then raise exception 'Enter a reason'; end if;
  if exists(select 1 from public.crm_payments where invoice_id=p_invoice) then
   raise exception 'Invoices with recorded payments are locked';
  end if;
  if p_action='cancel' then
   perform public.billing_cancel_invoice(p_invoice,p_reason);
  else
   update public.crm_invoices set status='void',updated_at=now()
   where id=p_invoice and status='draft'
     and coalesce(invoice_details->>'documentType','invoice')='invoice';
   if not found then raise exception 'Invoice draft changed. Refresh before deleting.'; end if;
  end if;
  return p_invoice;
 end if;
 raise exception 'Invalid invoice action';
end $$;
revoke all on function public.billing_confirmed_invoice_change(uuid,uuid,text,text,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.billing_confirmed_invoice_change(uuid,uuid,text,text,uuid,timestamptz,jsonb) to service_role;
revoke execute on function public.billing_cancel_invoice(uuid,text) from authenticated;
create index invoice_history_lookup on public.audit_logs(organization_id,entity_id,id desc)
 where entity_type='crm_invoices' and action like 'invoice_history_%';
