-- Supplementary documents are separate from CRM receivables and never accept payments.
create table public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  request_id uuid not null,
  kind text not null check (kind in ('quotation', 'proforma', 'credit_note', 'debit_note')),
  status text not null check (status in ('draft', 'issued')),
  accepted_at timestamptz,
  converted_invoice_id uuid unique references public.crm_invoices(id),
  client_id uuid not null references public.crm_clients(id),
  source_invoice_id uuid references public.crm_invoices(id),
  title text not null check (length(trim(title)) between 1 and 200),
  notes text not null default '' check (length(notes) <= 4000),
  due_date date,
  amount numeric(12,2) not null check (amount > 0),
  invoice_details jsonb not null check (
    invoice_details <> '{}'::jsonb and invoice_details->>'documentType' = 'quotation'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, request_id),
  check (accepted_at is null or (kind = 'quotation' and status = 'issued')),
  check (converted_invoice_id is null or (status = 'issued' and (kind = 'proforma' or accepted_at is not null))),
  check (
    (kind in ('credit_note', 'debit_note') and source_invoice_id is not null and status = 'draft' and length(trim(notes)) > 0)
    or (kind in ('quotation', 'proforma') and source_invoice_id is null)
  )
);

create index billing_documents_recent on public.billing_documents(organization_id, kind, updated_at desc);
create unique index billing_documents_reference on public.billing_documents(
  organization_id, kind, (invoice_details->>'reference')
) where coalesce(invoice_details->>'reference', '') <> '';

alter table public.billing_documents enable row level security;
revoke all on public.billing_documents from public, anon, authenticated;
grant select on public.billing_documents to authenticated;
create policy billing_documents_read on public.billing_documents for select to authenticated
  using (public.crm_can_access(organization_id, null));

create trigger billing_document_template_validate before insert or update on public.billing_documents
  for each row execute function public.validate_invoice_template();

alter table public.crm_invoices add column billing_request_id uuid;
create unique index crm_invoice_billing_request on public.crm_invoices(organization_id, billing_request_id)
  where billing_request_id is not null;

-- Lock and verify the draft before delegating to the existing audited CRM save.
create function public.billing_save_invoice(p_id uuid, p_request uuid, p_version timestamptz, p_values jsonb)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  org uuid := public.current_organization_id();
  existing public.crm_invoices;
  saved uuid;
begin
  perform public.assert_admin();
  if not public.crm_can_access(org, null) or exists (
    select 1 from public.profiles where user_id = auth.uid() and password_change_required
  ) then raise exception 'Active administrator access required'; end if;
  if p_values->>'status' is null or p_values->>'status' not in ('draft', 'issued')
    or p_values->'invoice_details'->>'documentType' is distinct from 'invoice' then
    raise exception 'Invalid invoice';
  end if;
  if p_id is null then
    if p_request is null then raise exception 'Request ID required'; end if;
    perform pg_advisory_xact_lock(hashtextextended(org::text || ':billing-invoice:' || p_request::text, 0));
    select id into saved from public.crm_invoices where organization_id = org and billing_request_id = p_request;
    if saved is not null then return saved; end if;
  else
    select * into existing from public.crm_invoices where id = p_id and organization_id = org for update;
    if existing.id is null or existing.status <> 'draft'
      or coalesce(existing.invoice_details->>'documentType', 'invoice') <> 'invoice'
      or existing.updated_at is distinct from p_version then
      raise exception 'Invoice draft changed. Reopen it before saving.';
    end if;
  end if;
  saved := public.crm_save('invoices', p_id, p_values);
  if p_id is null then
    update public.crm_invoices set billing_request_id = p_request where id = saved and organization_id = org;
  end if;
  return saved;
end $$;

create function public.billing_save_document(
  p_kind text, p_id uuid, p_request uuid, p_version timestamptz, p_source uuid, p_values jsonb
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  org uuid := public.current_organization_id();
  client uuid := (p_values->>'client_id')::uuid;
  existing public.billing_documents;
  saved uuid;
begin
  if not public.crm_can_access(org, null) or exists (
    select 1 from public.profiles where user_id = auth.uid() and password_change_required
  ) then raise exception 'Active administrator access required'; end if;
  if p_id is null then
    if p_request is null then raise exception 'Request ID required'; end if;
    perform pg_advisory_xact_lock(hashtextextended(org::text || ':billing-document:' || p_request::text, 0));
    select * into existing from public.billing_documents where organization_id = org and request_id = p_request;
    if existing.id is not null then
      if existing.kind is distinct from p_kind then raise exception 'Request ID already used'; end if;
      return existing.id;
    end if;
  else
    select * into existing from public.billing_documents
      where id = p_id and organization_id = org and kind = p_kind for update;
    if existing.id is null or existing.status <> 'draft' or existing.updated_at is distinct from p_version then
      raise exception 'Document draft changed. Reopen it before saving.';
    end if;
  end if;
  perform 1 from public.crm_clients where id = client and organization_id = org for share;
  if not found then raise exception 'Client unavailable'; end if;
  if p_kind in ('credit_note', 'debit_note') then
    perform 1 from public.crm_invoices where id = p_source and organization_id = org and client_id = client
      and status = 'issued' and coalesce(invoice_details->>'documentType', 'invoice') = 'invoice' for share;
    if not found then raise exception 'Choose an issued invoice for this client'; end if;
  end if;
  if p_id is null then
    insert into public.billing_documents
      (organization_id, request_id, kind, source_invoice_id, client_id, title, status, notes, due_date, amount, invoice_details)
    values
      (org, p_request, p_kind, p_source, client, p_values->>'title', p_values->>'status', p_values->>'notes',
       nullif(p_values->>'due_date', '')::date, (p_values->>'amount')::numeric, p_values->'invoice_details')
    returning id into saved;
  else
    update public.billing_documents set source_invoice_id = p_source, client_id = client,
      title = p_values->>'title', status = p_values->>'status', notes = p_values->>'notes',
      due_date = nullif(p_values->>'due_date', '')::date, amount = (p_values->>'amount')::numeric,
      invoice_details = p_values->'invoice_details', updated_at = now()
    where id = p_id returning id into saved;
  end if;
  insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata)
  values (org, auth.uid(), case when p_id is null then 'record_created' else 'record_updated' end,
    'billing_documents', saved::text, gen_random_uuid(), jsonb_build_object(
      'kind', p_kind, 'before', case when p_id is not null then to_jsonb(existing) end,
      'after', p_values || jsonb_build_object('source_invoice_id', p_source)
    ));
  return saved;
end $$;

revoke all on function public.billing_save_invoice(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.billing_save_document(text, uuid, uuid, timestamptz, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.billing_save_invoice(uuid, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.billing_save_document(text, uuid, uuid, timestamptz, uuid, jsonb) to authenticated;

-- Acceptance and conversion serialize on the source document. The invoice and
-- its source link commit together, so retries cannot create another invoice.
create function public.billing_transition_document(p_id uuid, p_intent text)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  org uuid := public.current_organization_id();
  source public.billing_documents;
  local_date date;
  invoice_id uuid;
  event text;
begin
  perform public.assert_admin();
  if not public.crm_can_access(org, null) or exists (
    select 1 from public.profiles where user_id = auth.uid() and password_change_required
  ) then raise exception 'Active administrator access required'; end if;
  select * into source from public.billing_documents where id = p_id and organization_id = org for update;
  if source.id is null or source.status <> 'issued' or source.kind not in ('quotation', 'proforma') then
    raise exception 'Issued quotation or proforma unavailable';
  end if;
  select (now() at time zone timezone)::date into local_date from public.organizations where id = org;
  if p_intent = 'accept' and source.kind = 'quotation' then
    if source.accepted_at is not null then return source.id; end if;
    if source.due_date < local_date then raise exception 'This quotation has expired'; end if;
    update public.billing_documents set accepted_at = now(), updated_at = now() where id = p_id;
    event := 'quotation_accepted';
  elsif p_intent = 'convert' and (source.kind = 'proforma' or source.accepted_at is not null) then
    if source.converted_invoice_id is not null then return source.converted_invoice_id; end if;
    invoice_id := public.crm_save('invoices', null, jsonb_build_object(
      'title', source.title, 'notes', source.notes, 'status', 'draft', 'client_id', source.client_id,
      'amount', source.amount, 'invoice_details', source.invoice_details || jsonb_build_object(
        'documentType', 'invoice', 'reference', '', 'invoiceDate', local_date::text
      )
    ));
    update public.billing_documents set converted_invoice_id = invoice_id, updated_at = now() where id = p_id;
    event := 'billing_document_converted';
  else
    raise exception 'Accept the quotation before converting';
  end if;
  insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata)
  values (org, auth.uid(), event, 'billing_documents', p_id::text, gen_random_uuid(),
    jsonb_build_object('kind', source.kind, 'invoice_id', invoice_id));
  return coalesce(invoice_id, p_id);
end $$;

revoke all on function public.billing_transition_document(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_transition_document(uuid, text) to authenticated;
