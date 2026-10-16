-- One durable notification per leave request; mailbox selection stays in Web3Forms.
create table public.leave_email_notifications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 leave_request_id uuid not null unique references public.leave_requests(id),
 state text not null default 'pending' check(state in ('pending','sending','sent','failed','uncertain')),
 attempts integer not null default 0, lease_id uuid, claimed_at timestamptz, sent_at timestamptz,
 last_error text, created_at timestamptz not null default now()
);
alter table public.leave_email_notifications enable row level security;
grant select on public.leave_email_notifications to authenticated;
create policy leave_email_admin_read on public.leave_email_notifications for select to authenticated using(
 organization_id=public.current_organization_id() and public.has_portal_role(array['admin']::public.portal_role[]));
grant all on public.leave_email_notifications to service_role;
create index leave_email_pending on public.leave_email_notifications(created_at) where state='pending';
create function public.enqueue_leave_email()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.state='pending' then insert into public.leave_email_notifications(organization_id,leave_request_id)
 values(new.organization_id,new.id) on conflict(leave_request_id) do nothing; end if;
 return new;
end $$;
revoke all on function public.enqueue_leave_email() from public,anon,authenticated;
create trigger leave_email_enqueue after insert on public.leave_requests for each row execute function public.enqueue_leave_email();

create function public.claim_leave_email(p_org uuid,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.leave_email_notifications; payload jsonb;
begin
 -- Do not automatically resend an ambiguous delivery: Web3Forms has no idempotency key.
 update public.leave_email_notifications set state='uncertain',last_error='Worker stopped before delivery was confirmed'
 where organization_id=p_org and state='sending' and claimed_at<now()-interval '2 minutes';
 select * into item from public.leave_email_notifications where organization_id=p_org and state='pending'
 and (p_request is null or leave_request_id=p_request) order by created_at for update skip locked limit 1;
 if item.id is null then return null; end if;
 update public.leave_email_notifications set state='sending',attempts=attempts+1,lease_id=gen_random_uuid(),claimed_at=now()
 where id=item.id returning * into item;
 select jsonb_build_object('id',item.id,'lease',item.lease_id,'employee',e.full_name,'email',e.work_email,
 'leaveType',t.name,'start',r.start_date,'end',r.end_date,'days',r.requested_days,'reason',r.reason,'requestId',r.id)
 into payload from public.leave_requests r join public.employees e on e.id=r.employee_id join public.leave_types t on t.id=r.leave_type_id
 where r.id=item.leave_request_id;
 return payload;
end $$;
revoke all on function public.claim_leave_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_leave_email(uuid,uuid) to service_role;

create function public.retry_leave_email(p_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 perform public.assert_admin();
 update public.leave_email_notifications set state='pending',lease_id=null,claimed_at=null,last_error=null
 where id=p_id and organization_id=public.current_organization_id() and (state in ('failed','uncertain') or (state='sending' and claimed_at<now()-interval '2 minutes'));
 if not found then raise exception 'Only failed or uncertain notifications can be retried'; end if;
end $$;
revoke all on function public.retry_leave_email(uuid) from public,anon;
grant execute on function public.retry_leave_email(uuid) to authenticated;

-- Browser delivery confirmation is informational; it never approves the leave.
create function public.finish_leave_email(p_id uuid,p_lease uuid,p_state text)
returns void language plpgsql security definer set search_path=public,auth as $$
begin
 if p_state is null or p_state not in ('sent','failed','uncertain') then raise exception 'Invalid notification outcome'; end if;
 update public.leave_email_notifications n set state=p_state,sent_at=case when p_state='sent' then now() end,
 last_error=case when p_state='sent' then null else 'Browser delivery could not be confirmed. Check the mailbox before retrying.' end
 where n.id=p_id and n.lease_id=p_lease and n.state='sending' and n.organization_id=public.current_organization_id()
 and (public.has_portal_role(array['admin']::public.portal_role[]) or exists(select 1 from public.leave_requests r where r.id=n.leave_request_id and r.requested_by=auth.uid()));
 if not found then raise exception 'Notification unavailable'; end if;
end $$;
revoke all on function public.finish_leave_email(uuid,uuid,text) from public,anon;
grant execute on function public.finish_leave_email(uuid,uuid,text) to authenticated;
