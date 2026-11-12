create function public.admin_record_bulk_attendance(
 p_employee uuid,p_dates date[],p_check_in time,p_check_out time,p_reason text
)
returns void language plpgsql security definer set search_path=public,auth as $$
declare work_day date; first_day date;
begin
 perform public.assert_admin();
 if p_dates is null or cardinality(p_dates) not between 1 and 31 or array_ndims(p_dates)<>1
 then raise exception 'Select between 1 and 31 dates'; end if;
 if cardinality(p_dates)<>(select count(distinct d) from unnest(p_dates) as dates(d))
 then raise exception 'Select distinct dates'; end if;
 select min(d) into first_day from unnest(p_dates) as dates(d);
 if exists(select 1 from unnest(p_dates) as dates(d) where date_trunc('month',d)<>date_trunc('month',first_day))
 then raise exception 'Select dates from one month'; end if;
 for work_day in select d from unnest(p_dates) as dates(d) order by d loop
  begin
   perform public.admin_record_manual_attendance(p_employee,work_day,p_check_in,p_check_out,p_reason,gen_random_uuid());
  exception when raise_exception then
   raise exception '%: %',work_day,sqlerrm;
  end;
 end loop;
end $$;

revoke all on function public.admin_record_bulk_attendance(uuid,date[],time,time,text) from public,anon;
grant execute on function public.admin_record_bulk_attendance(uuid,date[],time,time,text) to authenticated;
