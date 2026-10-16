alter table public.crm_invoices add column invoice_details jsonb not null default '{}';
create unique index crm_invoice_reference_unique on public.crm_invoices(organization_id,(invoice_details->>'reference'))
where coalesce(invoice_details->>'reference','')<>'';

create function public.validate_invoice_template()
returns trigger language plpgsql set search_path=public as $$
declare d jsonb:=new.invoice_details; item jsonb; qty numeric; rate numeric; subtotal numeric:=0; discount numeric; field text;
begin
 if tg_op='UPDATE' and old.status<>'draft' and (old.invoice_details is distinct from new.invoice_details
 or old.client_id is distinct from new.client_id or old.title is distinct from new.title) then raise exception 'Issued invoice billing details are locked'; end if;
 -- Existing aggregate-only invoices remain supported; rendering derives one line.
 if d='{}'::jsonb then return new; end if;
 if jsonb_typeof(d)<>'object' or coalesce(d->>'template','') not in ('classic','modern')
 or coalesce(d->>'documentType','') not in ('invoice','quotation')
 or coalesce(d->>'invoiceDate','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid invoice design or date'; end if;
 perform (d->>'invoiceDate')::date;
 foreach field in array array['reference','address','attention','gstin','placeOfSupply'] loop
  if d ? field and jsonb_typeof(d->field)<>'string' then raise exception 'Invalid invoice text field'; end if;
 end loop;
 if length(coalesce(d->>'reference',''))>40 or length(coalesce(d->>'address',''))>300
 or length(coalesce(d->>'attention',''))>100 or length(coalesce(d->>'placeOfSupply',''))>80
 or coalesce(d->>'gstin','') !~ '^$|^[0-9A-Z]{15}$' then raise exception 'Invalid billing details'; end if;
 if jsonb_typeof(d->'items') is distinct from 'array' then raise exception 'Invoice items required'; end if;
 if jsonb_array_length(d->'items') not between 1 and 50 then raise exception 'Use 1 to 50 invoice items'; end if;
 if d ? 'discountPercent' and jsonb_typeof(d->'discountPercent')<>'number' then raise exception 'Invalid discount type'; end if;
 discount:=coalesce((d->>'discountPercent')::numeric,0);
 if not(discount between 0 and 99.99) or discount<>round(discount,2) then raise exception 'Invalid invoice discount'; end if;
 for item in select value from jsonb_array_elements(d->'items') loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'description') is distinct from 'string'
  or length(trim(item->>'description')) not between 1 and 200
  or (item ? 'details' and jsonb_typeof(item->'details')<>'string') or length(coalesce(item->>'details',''))>300
  or (item ? 'hsnSac' and jsonb_typeof(item->'hsnSac')<>'string') or length(coalesce(item->>'hsnSac',''))>12
  or coalesce(item->>'hsnSac','') !~ '^[0-9A-Za-z/-]*$'
  or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'rate') is distinct from 'number'
  then raise exception 'Invalid invoice item'; end if;
  qty:=(item->>'quantity')::numeric; rate:=(item->>'rate')::numeric;
  if not(qty>0 and qty<=100000 and rate>=0 and rate<=9999999999.99) or qty<>round(qty,2) or rate<>round(rate,2) then raise exception 'Invalid quantity or rate'; end if;
  subtotal:=subtotal+round(qty*rate,2);
 end loop;
 if subtotal>9999999999.99 or new.amount is distinct from subtotal-round(subtotal*discount/100,2) then raise exception 'Invoice total does not match its items and discount'; end if;
 return new;
end $$;
revoke all on function public.validate_invoice_template() from public,anon,authenticated;
create trigger invoice_template_validate before insert or update on public.crm_invoices for each row execute function public.validate_invoice_template();

-- Extend the existing audited write; retain assignment, tenant and invoice guards.
create or replace function public.crm_save(p_module text,p_id uuid,p_values jsonb)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare t text; org uuid; v_id uuid; own uuid; client uuid; is_admin boolean; old_record jsonb; cols text; vals text;
begin
 org=public.current_organization_id();
 if org is null or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Active workspace access required'; end if;
 t=case p_module when 'clients' then 'crm_clients' when 'leads' then 'crm_leads' when 'documents' then 'crm_documents' when 'compliance' then 'crm_compliance' when 'invoices' then 'crm_invoices' when 'tasks' then 'crm_tasks' when 'support' then 'crm_support' end;
 if t is null then raise exception 'Unknown module'; end if;
 is_admin=public.has_portal_role(array['admin','partner']::public.portal_role[]);
 if not is_admin and p_id is null then raise exception 'Administrator creates records and assignments'; end if;
 if p_id is not null then
  execute format('select to_jsonb(r) from public.%I r where id=$1 and organization_id=$2 for update',t) into old_record using p_id,org;
  if old_record is null or not public.crm_can_access(org,(old_record->>'owner_id')::uuid) then raise exception 'Record unavailable'; end if;
 end if;
 own=nullif(p_values->>'owner_id','')::uuid; client=nullif(p_values->>'client_id','')::uuid;
 if not is_admin and (own is distinct from (old_record->>'owner_id')::uuid or client is distinct from (old_record->>'client_id')::uuid or p_module in ('clients','leads','invoices')) then raise exception 'Administrator required for this change'; end if;
 if own is not null and not exists(select 1 from public.employees where id=own and organization_id=org and active) then raise exception 'Invalid owner'; end if;
 if client is not null and not exists(select 1 from public.crm_clients where id=client and organization_id=org) then raise exception 'Invalid client'; end if;
 if length(trim(p_values->>'title')) not between 1 and 200 or length(coalesce(p_values->>'notes',''))>4000 then raise exception 'Invalid title or notes'; end if;
 if p_module='invoices' and old_record is not null and (old_record->>'status')<>'draft' and (p_values->>'amount')::numeric is distinct from (old_record->>'amount')::numeric then raise exception 'Issued invoice amount cannot change'; end if;
 cols='title,status,notes,owner_id'; vals='($1->>''title''),($1->>''status''),coalesce($1->>''notes'',''''),nullif($1->>''owner_id'','''')::uuid';
 if p_module in ('clients','leads') then cols=cols||',email,phone'; vals=vals||',nullif($1->>''email'',''''),nullif($1->>''phone'','''')'; end if;
 if p_module<>'clients' then cols=cols||',client_id,due_date'; vals=vals||',nullif($1->>''client_id'','''')::uuid,nullif($1->>''due_date'','''')::date'; end if;
 if p_module='invoices' then
  p_values:=p_values||jsonb_build_object('invoice_details',coalesce(p_values->'invoice_details',old_record->'invoice_details','{}'::jsonb));
  cols=cols||',amount,invoice_details'; vals=vals||',($1->>''amount'')::numeric,($1->''invoice_details'')';
 end if;
 if p_id is null then execute format('insert into public.%I(organization_id,%s) select $2,%s returning id',t,cols,vals) into v_id using p_values,org;
 else execute format('update public.%I set (%s)=(select %s),updated_at=now() where id=$2 returning id',t,cols,vals) into v_id using p_values,p_id; end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
 values(org,auth.uid(),case when p_id is null then 'record_created' else 'record_updated' end,t,v_id::text,gen_random_uuid(),jsonb_build_object('before',old_record,'after',p_values));
 return v_id;
end $$;
