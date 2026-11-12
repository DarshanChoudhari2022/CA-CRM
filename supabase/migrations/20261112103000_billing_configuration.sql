create table public.billing_service_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 300),
  sac_code text not null default '' check (sac_code ~ '^[0-9A-Za-z/-]{0,12}$'),
  unit_price numeric(14,2) not null check (unit_price between 0 and 9999999999.99),
  gst_rate numeric(5,2) not null check (gst_rate between 0 and 100),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index billing_service_catalog_org_name
  on public.billing_service_catalog (organization_id, lower(name));

create table public.billing_practice_settings (
  organization_id uuid not null references public.organizations(id),
  section text not null check (section in ('firm','bank','branding','numbering','sharing','smart-drafts')),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (organization_id, section)
);

alter table public.billing_service_catalog enable row level security;
alter table public.billing_practice_settings enable row level security;
revoke all on public.billing_service_catalog, public.billing_practice_settings from public, anon, authenticated;
grant select on public.billing_service_catalog, public.billing_practice_settings to authenticated;

create policy billing_catalog_admin_read on public.billing_service_catalog
for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and (select public.has_portal_role(array['admin','partner']::public.portal_role[]))
);

create policy billing_settings_admin_read on public.billing_practice_settings
for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and (select public.has_portal_role(array['admin','partner']::public.portal_role[]))
);

create function public.billing_save_service(
  p_id uuid, p_name text, p_description text, p_sac_code text,
  p_unit_price numeric, p_gst_rate numeric, p_active boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  saved_id uuid;
begin
  perform public.assert_admin();
  org := public.current_organization_id();
  if org is null then raise exception 'Active organization required'; end if;

  if p_unit_price <> round(p_unit_price, 2) or p_gst_rate <> round(p_gst_rate, 2) then
    raise exception 'Use at most two decimal places';
  end if;

  if p_id is null then
    insert into public.billing_service_catalog
      (organization_id, name, description, sac_code, unit_price, gst_rate, active)
    values (org, btrim(p_name), btrim(p_description), btrim(p_sac_code), p_unit_price, p_gst_rate, p_active)
    returning id into saved_id;
  else
    update public.billing_service_catalog
      set name = btrim(p_name), description = btrim(p_description), sac_code = btrim(p_sac_code),
          unit_price = p_unit_price, gst_rate = p_gst_rate, active = p_active, updated_at = now()
      where organization_id = org and id = p_id
      returning id into saved_id;
    if saved_id is null then raise exception 'Service unavailable'; end if;
  end if;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, request_id, metadata)
    values (org, auth.uid(), case when p_id is null then 'billing_service_created' else 'billing_service_updated' end,
            'billing_service_catalog', saved_id::text, gen_random_uuid(), jsonb_build_object('active', p_active));
  return saved_id;
end;
$$;

create function public.billing_save_practice_settings(p_section text, p_settings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  rules constant jsonb := $rules$
  {
    "firm": {
      "legal_name": [160],
      "trade_name": [160],
      "gstin": [15,"^[0-9A-Z]{15}$"],
      "pan": [10,"^[A-Z]{5}[0-9]{4}[A-Z]$"],
      "email": [160,"^[^ @]+@[^ @]+[.][^ @]+$"],
      "phone": [30],
      "address": [500]
    },
    "bank": {
      "beneficiary": [160],
      "bank_name": [120],
      "branch": [120],
      "account_number": [34,"^[0-9]{6,34}$"],
      "ifsc": [11,"^[A-Z]{4}0[A-Z0-9]{6}$"],
      "upi_id": [120,"^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$"]
    },
    "branding": {
      "logo_url": [500,"^https://[^ /]+[^ ]*$"],
      "accent_color": [7,"^#[0-9A-Fa-f]{6}$"],
      "footer": [500]
    },
    "numbering": {
      "invoice_prefix": [16,"^[A-Za-z0-9/_-]+$"],
      "quotation_prefix": [16,"^[A-Za-z0-9/_-]+$"],
      "starting_number": [9,"^[1-9][0-9]{0,8}$"]
    },
    "sharing": {
      "email_subject": [160],
      "email_body": [2000],
      "whatsapp_body": [1000]
    },
    "smart-drafts": {
      "title_prefix": [80],
      "review_notes": [1000],
      "payment_terms_days": [3,"^(0|[1-9][0-9]{0,2})$"]
    }
  }$rules$;
  allowed jsonb := rules->p_section;
  field_name text;
  field_value jsonb;
  value_text text;
  rule jsonb;
begin
  perform public.assert_admin();
  org := public.current_organization_id();
  if org is null then raise exception 'Active organization required'; end if;

  if allowed is null or jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'Invalid billing settings section';
  end if;

  for field_name, field_value in select key, value from jsonb_each(p_settings) loop
    rule := allowed->field_name;
    if rule is null or jsonb_typeof(field_value) is distinct from 'string' then
      raise exception 'Invalid billing settings field';
    end if;
    value_text := field_value #>> '{}';
    if length(value_text) > (rule->>0)::integer
       or (value_text <> '' and rule->>1 is not null and value_text !~ (rule->>1)) then
      raise exception 'Invalid billing settings value';
    end if;
  end loop;

  insert into public.billing_practice_settings (organization_id, section, settings)
    values (org, p_section, p_settings)
    on conflict (organization_id, section)
    do update set settings = excluded.settings, updated_at = now();

  -- Keep configuration values out of the audit log.
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, request_id)
    values (org, auth.uid(), 'billing_settings_saved', 'billing_practice_settings', p_section, gen_random_uuid());
end;
$$;

revoke all on function public.billing_save_service(uuid, text, text, text, numeric, numeric, boolean) from public, anon, authenticated;
revoke all on function public.billing_save_practice_settings(text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_save_service(uuid, text, text, text, numeric, numeric, boolean) to authenticated;
grant execute on function public.billing_save_practice_settings(text, jsonb) to authenticated;
