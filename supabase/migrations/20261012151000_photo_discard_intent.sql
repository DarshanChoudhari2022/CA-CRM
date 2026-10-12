alter table public.daily_report_photos drop constraint daily_report_photos_state_check;
alter table public.daily_report_photos add constraint daily_report_photos_state_check check(state in ('pending','ready','discarding'));
create function public.daily_photo_owned(p_employee uuid,p_org uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p join public.employees e on e.id=p.employee_id where p.user_id=auth.uid()
 and p.active and not p.password_change_required and e.active and e.id=p_employee and e.organization_id=p_org and p.organization_id=p_org);
$$;
revoke all on function public.daily_photo_owned(uuid,uuid) from public,anon;
grant execute on function public.daily_photo_owned(uuid,uuid) to authenticated;
create function public.prepare_daily_photo_discard(p_id uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare photo public.daily_report_photos;
begin
 select * into photo from public.daily_report_photos where id=p_id;
 perform 1 from public.daily_work_reports where id=photo.report_id for update;
 select * into photo from public.daily_report_photos where id=p_id for update;
 if photo.id is null or not coalesce(public.daily_photo_owned(photo.employee_id,photo.organization_id),false) or photo.state='ready' then raise exception 'Only your unfinished photo can be discarded'; end if;
 update public.daily_report_photos set state='discarding' where id=p_id;
end $$;
revoke all on function public.prepare_daily_photo_discard(uuid) from public,anon;
grant execute on function public.prepare_daily_photo_discard(uuid) to authenticated;
create or replace function public.finish_daily_photo(p_id uuid)
returns void language plpgsql security definer set search_path=public,storage,auth as $$
declare photo public.daily_report_photos; report public.daily_work_reports;
begin
 select * into photo from public.daily_report_photos where id=p_id;
 select * into report from public.daily_work_reports where id=photo.report_id for update;
 select * into photo from public.daily_report_photos where id=p_id for update;
 if photo.id is null or not coalesce(public.daily_report_editable(photo.employee_id,photo.organization_id,report.work_date),false) then raise exception 'Only your photo for today can be attached'; end if;
 if photo.state='ready' then return; end if;
 if photo.state<>'pending' then raise exception 'This unfinished upload is being discarded'; end if;
 if not exists(select 1 from storage.objects where bucket_id='attendance-photos' and name=photo.storage_path and metadata->>'mimetype'=photo.content_type and (metadata->>'size')::bigint=photo.byte_size) then raise exception 'Photo upload incomplete or metadata does not match'; end if;
 update public.daily_report_photos set state='ready' where id=photo.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(photo.organization_id,auth.uid(),'daily_photo_attached','daily_work_report',report.id::text,p_id);
end $$;
create or replace function public.cancel_daily_photo(p_id uuid)
returns void language plpgsql security definer set search_path=public,storage,auth as $$
declare photo public.daily_report_photos;
begin
 select * into photo from public.daily_report_photos where id=p_id;
 perform 1 from public.daily_work_reports where id=photo.report_id for update;
 select * into photo from public.daily_report_photos where id=p_id for update;
 if photo.id is null or not coalesce(public.daily_photo_owned(photo.employee_id,photo.organization_id),false) or photo.state<>'discarding' then raise exception 'Only your unfinished discard can be completed'; end if;
 if exists(select 1 from storage.objects where bucket_id='attendance-photos' and name=photo.storage_path) then raise exception 'Remove the unfinished file before releasing the slot'; end if;
 delete from public.daily_report_photos where id=photo.id;
end $$;
alter policy attendance_photo_download on storage.objects using(bucket_id='attendance-photos' and exists(
 select 1 from public.daily_report_photos p where p.storage_path=name and
 ((p.state='ready' and p.organization_id=public.current_organization_id() and public.can_view_employee(p.employee_id) and not exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required))
 or(p.state in ('pending','discarding') and public.daily_photo_owned(p.employee_id,p.organization_id)))));
alter policy attendance_photo_discard on storage.objects using(bucket_id='attendance-photos' and exists(
 select 1 from public.daily_report_photos p where p.storage_path=name and p.state='discarding' and public.daily_photo_owned(p.employee_id,p.organization_id)));
