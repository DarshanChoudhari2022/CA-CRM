create or replace function public.track_invoice_changes()
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
  -- Client reassignment propagates ownership through the client's AFTER trigger.
  if pg_trigger_depth() > 1
     and (before_values - 'owner_id') = (after_values - 'owner_id')
     and exists (
      select 1 from public.crm_clients c
      where c.id = new.client_id and c.organization_id = new.organization_id
        and c.owner_id is not distinct from new.owner_id
     ) then
   operation := 'reassigned';
  elsif coalesce(operation, '') not in ('edit','delete','cancel') then
   raise exception 'Confirm your password in the Invoice Ledger.';
  end if;
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 values (new.organization_id,auth.uid(),'invoice_history_' || coalesce(nullif(operation,''),'created'),
         'crm_invoices',new.id::text,jsonb_build_object('before',before_values,'after',after_values,
         'reason',nullif(current_setting('psb.invoice_reason',true),'')));
 return new;
end $$;
