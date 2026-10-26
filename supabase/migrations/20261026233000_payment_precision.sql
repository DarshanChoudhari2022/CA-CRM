-- Reject fractional paise before numeric(12,2) can silently round a manual payment.
create or replace function public.crm_record_payment(p_invoice uuid,p_amount numeric,p_reference text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare inv public.crm_invoices; total numeric; result uuid;
begin
 if not public.has_portal_role(array['admin','partner']::public.portal_role[]) then raise exception 'Administrator required'; end if;
 select * into inv from public.crm_invoices where id=p_invoice and organization_id=public.current_organization_id() for update;
 if inv.id is null or inv.status<>'issued' then raise exception 'Only issued invoices accept payments'; end if;
 if p_amount<=0 or p_amount is null or length(trim(p_reference)) not between 3 and 120 then raise exception 'Invalid amount or payment reference'; end if;
 if p_amount<>round(p_amount,2) then raise exception 'Payment amount must have at most 2 decimal places'; end if;
 select coalesce(sum(amount),0) into total from public.crm_payments where invoice_id=inv.id;
 if total+p_amount>inv.amount then raise exception 'Payment exceeds outstanding amount'; end if;
 insert into public.crm_payments(organization_id,invoice_id,amount,reference,recorded_by) values(inv.organization_id,inv.id,p_amount,trim(p_reference),auth.uid()) returning id into result;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(inv.organization_id,auth.uid(),'payment_recorded','invoice',inv.id::text,gen_random_uuid());
 return result;
end $$;
revoke all on function public.crm_record_payment(uuid,numeric,text) from public,anon;
grant execute on function public.crm_record_payment(uuid,numeric,text) to authenticated;
