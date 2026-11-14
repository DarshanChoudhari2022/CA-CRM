create index attendance_days_open_checkout_idx
 on public.attendance_days (organization_id, work_date)
 where check_in_at is not null and check_out_at is null;

create function public.auto_checkout_attendance(p_since date default date '2026-11-13')
returns integer language plpgsql security definer set search_path = '' as $$
declare
 candidate record;
 closed_day record;
 processed integer := 0;
begin
 for candidate in
  select d.organization_id, d.work_date, d.employee_id, d.id,
         ((d.work_date + 1) + time '03:00') at time zone o.timezone as cutoff
  from public.attendance_days d
  join public.organizations o on o.id = d.organization_id
  where d.work_date >= p_since
    and d.work_date < (now() at time zone o.timezone)::date
    and d.check_out_at is null
    and d.check_in_at < ((d.work_date + 1) + time '03:00') at time zone o.timezone
    and ((d.work_date + 1) + time '03:00') at time zone o.timezone <= now()
    and not public.month_is_closed(d.organization_id, d.work_date)
  order by d.organization_id, d.work_date, d.employee_id
 loop
  -- Acquire the same month and employee locks as the attendance writers.
  insert into public.attendance_months (organization_id, month_start)
   values (candidate.organization_id, date_trunc('month', candidate.work_date)::date)
   on conflict do nothing;
  perform 1 from public.attendance_months
   where organization_id = candidate.organization_id
     and month_start = date_trunc('month', candidate.work_date)::date
   for update skip locked;
  if not found or public.month_is_closed(candidate.organization_id, candidate.work_date) then continue; end if;
  perform pg_advisory_xact_lock(hashtextextended(candidate.employee_id::text || ':attendance-leave', 0));

  update public.attendance_days d
  set check_out_at = candidate.cutoff,
      duration_minutes = floor(extract(epoch from candidate.cutoff - d.check_in_at) / 60),
      result = case
       when d.calendar_context <> 'working_day' then 'not_applicable'
       when candidate.cutoff - d.check_in_at >= make_interval(mins => p.full_day_minutes) then 'full_day'
       when candidate.cutoff - d.check_in_at >= make_interval(mins => p.half_day_minutes) then 'half_day'
       else 'short_day'
      end::public.attendance_result,
      is_early_departure = false, revision = d.revision + 1, updated_at = now()
  from public.attendance_policies p
  where d.id = candidate.id and p.id = d.policy_id
    and d.check_out_at is null and d.check_in_at < candidate.cutoff
  returning d.revision into closed_day;
  if not found then continue; end if;

  -- A system checkout must not invalidate an already submitted correction.
  update public.attendance_corrections
  set base_revision = closed_day.revision
  where employee_id = candidate.employee_id and work_date = candidate.work_date
    and state = 'pending' and base_revision = closed_day.revision - 1;

  insert into public.audit_logs (organization_id, action, entity_type, entity_id, metadata)
  values (candidate.organization_id, 'automatic_check_out', 'attendance_day', candidate.id::text,
          jsonb_build_object('checkOutAt', candidate.cutoff));
  processed := processed + 1;
 end loop;
 return processed;
end;
$$;

revoke all on function public.auto_checkout_attendance(date) from public, anon, authenticated;

-- Check each minute for organizations whose local cutoff has passed.
select cron.schedule('psb-auto-attendance-checkout', '* * * * *',
 'select public.auto_checkout_attendance()');
