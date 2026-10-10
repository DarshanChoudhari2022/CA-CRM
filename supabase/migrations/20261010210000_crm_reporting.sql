create function public.crm_financial_summary()
returns jsonb language sql stable security definer set search_path=public,auth as $$
 select case when public.has_portal_role(array['admin','partner']::public.portal_role[]) then
 jsonb_build_object('issued', (select coalesce(sum(amount),0) from public.crm_invoices where organization_id=public.current_organization_id() and status='issued'),
 'received',(select coalesce(sum(amount),0) from public.crm_payments where organization_id=public.current_organization_id()))
 else null end;
$$;
revoke all on function public.crm_financial_summary() from public,anon;
grant execute on function public.crm_financial_summary() to authenticated;

create function public.crm_invoice_receipts(p_ids uuid[])
returns table(invoice_id uuid,received numeric) language sql stable security definer set search_path=public,auth as $$
 select i.id,coalesce(sum(p.amount),0) from public.crm_invoices i left join public.crm_payments p on p.invoice_id=i.id
 where i.id=any(p_ids) and public.crm_can_access(i.organization_id,i.owner_id) group by i.id;
$$;
revoke all on function public.crm_invoice_receipts(uuid[]) from public,anon;
grant execute on function public.crm_invoice_receipts(uuid[]) to authenticated;

create or replace function public.crm_can_access(p_org uuid,p_owner uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select p_org=public.current_organization_id()
 and not exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required)
 and (public.has_portal_role(array['admin','partner']::public.portal_role[])
 or (p_owner is not null and public.can_view_employee(p_owner)));
$$;

-- Guard sensitive admin RPCs as well as the UI while onboarding is incomplete.
create function public.crm_require_onboarded() returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
 if auth.uid() is not null and exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Change your temporary password first'; end if;
 return new;
end $$;
create trigger crm_payment_onboarding before insert on public.crm_payments for each row execute function public.crm_require_onboarded();
create trigger crm_outbox_onboarding before insert on public.crm_outbox for each row execute function public.crm_require_onboarded();
