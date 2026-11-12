create or replace function public.billing_save_practice_settings(p_section text, p_settings jsonb)
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
      "footer": [500],
      "terms": [3000],
      "default_layout": [7,"^(classic|modern|minimal)$"]
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
