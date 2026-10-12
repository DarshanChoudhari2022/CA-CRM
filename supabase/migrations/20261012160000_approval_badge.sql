create index if not exists leave_pending_count_idx
  on public.leave_requests (organization_id, employee_id) where state = 'pending';
create index if not exists correction_pending_count_idx
  on public.attendance_corrections (organization_id, employee_id) where state = 'pending';

create or replace function public.pending_approval_count()
returns bigint language sql stable security definer set search_path = public, auth as $$
  select
    (select count(*) from public.leave_requests
      where organization_id = public.current_organization_id()
        and state = 'pending' and public.is_reviewer_for(employee_id))
    + (select count(*) from public.attendance_corrections
      where organization_id = public.current_organization_id()
        and state = 'pending' and public.is_reviewer_for(employee_id));
$$;
revoke all on function public.pending_approval_count() from public, anon;
grant execute on function public.pending_approval_count() to authenticated;
