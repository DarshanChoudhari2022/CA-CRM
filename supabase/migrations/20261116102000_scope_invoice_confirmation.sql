create or replace function public.billing_confirmed_invoice_change(
 p_actor uuid, p_invoice uuid, p_action text, p_reason text default null,
 p_request uuid default null, p_version timestamptz default null, p_values jsonb default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
 invoice public.crm_invoices;
 org uuid;
 result uuid;
 prior_actor text := current_setting('request.jwt.claim.sub',true);
 prior_action text := current_setting('psb.invoice_change',true);
 prior_reason text := current_setting('psb.invoice_reason',true);
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
  result := public.billing_save_invoice(p_invoice,p_request,p_version,p_values);
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
  result := p_invoice;
 else
  raise exception 'Invalid invoice action';
 end if;
 perform set_config('request.jwt.claim.sub',coalesce(prior_actor,''),true);
 perform set_config('psb.invoice_change',coalesce(prior_action,''),true);
 perform set_config('psb.invoice_reason',coalesce(prior_reason,''),true);
 return result;
end $$;
