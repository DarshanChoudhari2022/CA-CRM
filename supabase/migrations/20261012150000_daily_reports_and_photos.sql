create table public.daily_work_reports (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 employee_id uuid not null references public.employees(id), work_date date not null,
 summary text not null default '' check(length(summary)<=4000), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,employee_id,work_date)
);
create table public.daily_report_photos (
 id uuid primary key, report_id uuid not null references public.daily_work_reports(id),
 organization_id uuid not null references public.organizations(id), employee_id uuid not null references public.employees(id),
 storage_path text not null unique, state text not null default 'pending' check(state in ('pending','ready')),
 content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size between 1 and 5242880), created_at timestamptz not null default now()
);
create index daily_report_employee_recent on public.daily_work_reports(employee_id,work_date desc);
create index daily_report_photo_report on public.daily_report_photos(report_id);
alter table public.daily_work_reports enable row level security;
alter table public.daily_report_photos enable row level security;
revoke all on public.daily_work_reports,public.daily_report_photos from anon,authenticated;
grant select on public.daily_work_reports,public.daily_report_photos to authenticated;
create policy daily_report_read on public.daily_work_reports for select to authenticated using(
 organization_id=(select public.current_organization_id()) and public.can_view_employee(employee_id)
 and not coalesce((select password_change_required from public.profiles where user_id=(select auth.uid())),true));
create policy daily_report_photo_read on public.daily_report_photos for select to authenticated using(
 organization_id=(select public.current_organization_id()) and public.can_view_employee(employee_id)
 and not coalesce((select password_change_required from public.profiles where user_id=(select auth.uid())),true));

create function public.daily_report_editable(p_employee uuid,p_org uuid,p_date date)
returns boolean language sql stable security definer set search_path=public,auth as $$
 select exists(select 1 from public.profiles p join public.employees e on e.id=p.employee_id join public.organizations o on o.id=e.organization_id
 where p.user_id=auth.uid() and p.active and not p.password_change_required and e.active and e.id=p_employee
 and e.organization_id=p_org and p.organization_id=p_org and p_date=(now() at time zone o.timezone)::date
 and public.day_context(e,p_date)<>'outside_employment' and not public.month_is_closed(p_org,p_date));
$$;
revoke all on function public.daily_report_editable(uuid,uuid,date) from public,anon;
grant execute on function public.daily_report_editable(uuid,uuid,date) to authenticated;

create function public.save_daily_report(p_summary text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; day date; result uuid;
begin
 select * into e from public.employees where id=public.current_employee_id();
 select (now() at time zone timezone)::date into day from public.organizations where id=e.organization_id;
 if not coalesce(public.daily_report_editable(e.id,e.organization_id,day),false) then raise exception 'Active employee access for today required'; end if;
 if p_summary is null or length(p_summary)>4000 then raise exception 'Summary must be at most 4000 characters'; end if;
 insert into public.daily_work_reports(organization_id,employee_id,work_date,summary) values(e.organization_id,e.id,day,trim(p_summary))
 on conflict(organization_id,employee_id,work_date) do update set summary=excluded.summary,updated_at=now() returning id into result;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(e.organization_id,auth.uid(),'daily_report_saved','daily_work_report',result::text,gen_random_uuid());
 return result;
end $$;
revoke all on function public.save_daily_report(text) from public,anon;
grant execute on function public.save_daily_report(text) to authenticated;

create function public.reserve_daily_photo(p_id uuid,p_content_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; day date; report public.daily_work_reports; photo public.daily_report_photos; path text;
begin
 select * into e from public.employees where id=public.current_employee_id();
 select (now() at time zone timezone)::date into day from public.organizations where id=e.organization_id;
 if not coalesce(public.daily_report_editable(e.id,e.organization_id,day),false) then raise exception 'Active employee access for today required'; end if;
 if p_id is null or p_content_type is null or p_content_type not in ('image/jpeg','image/png','image/webp') or p_size is null or p_size not between 1 and 5242880 then raise exception 'Choose a JPEG, PNG or WebP photo up to 5 MB'; end if;
 insert into public.daily_work_reports(organization_id,employee_id,work_date) values(e.organization_id,e.id,day) on conflict do nothing;
 select * into report from public.daily_work_reports where employee_id=e.id and work_date=day for update;
 select * into photo from public.daily_report_photos where id=p_id;
 if photo.id is not null then
  if photo.report_id<>report.id or photo.content_type<>p_content_type or photo.byte_size<>p_size then raise exception 'Photo request already used'; end if;
  return jsonb_build_object('id',photo.id,'path',photo.storage_path);
 end if;
 if (select count(*) from public.daily_report_photos where report_id=report.id)>=5 then raise exception 'Maximum 5 photos today. Discard unfinished uploads to free a slot.'; end if;
 path=e.organization_id::text||'/'||e.id::text||'/'||day::text||'/'||p_id::text;
 insert into public.daily_report_photos(id,report_id,organization_id,employee_id,storage_path,content_type,byte_size) values(p_id,report.id,e.organization_id,e.id,path,p_content_type,p_size);
 return jsonb_build_object('id',p_id,'path',path);
end $$;
revoke all on function public.reserve_daily_photo(uuid,text,integer) from public,anon;
grant execute on function public.reserve_daily_photo(uuid,text,integer) to authenticated;

create function public.finish_daily_photo(p_id uuid)
returns void language plpgsql security definer set search_path=public,storage,auth as $$
declare photo public.daily_report_photos; report public.daily_work_reports;
begin
 select * into photo from public.daily_report_photos where id=p_id;
 select * into report from public.daily_work_reports where id=photo.report_id for update;
 if photo.id is null or not coalesce(public.daily_report_editable(photo.employee_id,photo.organization_id,report.work_date),false) then raise exception 'Only your photo for today can be attached'; end if;
 select * into photo from public.daily_report_photos where id=p_id for update;
 if photo.state='ready' then return; end if;
 if not exists(select 1 from storage.objects where bucket_id='attendance-photos' and name=photo.storage_path
 and metadata->>'mimetype'=photo.content_type and (metadata->>'size')::bigint=photo.byte_size) then raise exception 'Photo upload incomplete or metadata does not match'; end if;
 update public.daily_report_photos set state='ready' where id=photo.id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) values(photo.organization_id,auth.uid(),'daily_photo_attached','daily_work_report',report.id::text,p_id);
end $$;
revoke all on function public.finish_daily_photo(uuid) from public,anon;
grant execute on function public.finish_daily_photo(uuid) to authenticated;

create function public.cancel_daily_photo(p_id uuid)
returns void language plpgsql security definer set search_path=public,storage,auth as $$
declare photo public.daily_report_photos; report public.daily_work_reports;
begin
 select * into photo from public.daily_report_photos where id=p_id;
 select * into report from public.daily_work_reports where id=photo.report_id for update;
 if photo.id is null or not coalesce(public.daily_report_editable(photo.employee_id,photo.organization_id,report.work_date),false) or photo.state<>'pending' then raise exception 'Only your unfinished upload for today can be discarded'; end if;
 if exists(select 1 from storage.objects where bucket_id='attendance-photos' and name=photo.storage_path) then raise exception 'Remove the unfinished file before releasing the slot'; end if;
 delete from public.daily_report_photos where id=photo.id;
end $$;
revoke all on function public.cancel_daily_photo(uuid) from public,anon;
grant execute on function public.cancel_daily_photo(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('attendance-photos','attendance-photos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy attendance_photo_upload on storage.objects for insert to authenticated with check(bucket_id='attendance-photos' and exists(
 select 1 from public.daily_report_photos p join public.daily_work_reports r on r.id=p.report_id where p.storage_path=name and p.state='pending' and public.daily_report_editable(p.employee_id,p.organization_id,r.work_date)));
create policy attendance_photo_download on storage.objects for select to authenticated using(bucket_id='attendance-photos' and exists(
 select 1 from public.daily_report_photos p join public.daily_work_reports r on r.id=p.report_id where p.storage_path=name and
 ((p.state='ready' and p.organization_id=public.current_organization_id() and public.can_view_employee(p.employee_id)
 and not exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required))
 or (p.state='pending' and public.daily_report_editable(p.employee_id,p.organization_id,r.work_date)))));
create policy attendance_photo_discard on storage.objects for delete to authenticated using(bucket_id='attendance-photos' and exists(
 select 1 from public.daily_report_photos p join public.daily_work_reports r on r.id=p.report_id where p.storage_path=name and p.state='pending' and public.daily_report_editable(p.employee_id,p.organization_id,r.work_date)));

create function public.my_daily_report()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare e public.employees; day date; report public.daily_work_reports;
begin
 select * into e from public.employees where id=public.current_employee_id();
 select (now() at time zone timezone)::date into day from public.organizations where id=e.organization_id;
 if e.id is null or not e.active or e.organization_id is distinct from public.current_organization_id() or exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Active employee access required'; end if;
 select * into report from public.daily_work_reports where employee_id=e.id and work_date=day;
 return jsonb_build_object('workDate',day,'canEdit',public.daily_report_editable(e.id,e.organization_id,day),'summary',coalesce(report.summary,''),'photos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'path',storage_path,'state',state) order by created_at) from public.daily_report_photos where report_id=report.id),'[]'::jsonb));
end $$;
revoke all on function public.my_daily_report() from public,anon;
grant execute on function public.my_daily_report() to authenticated;

create function public.dashboard_snapshot_v2()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare snapshot jsonb; minutes integer;
begin
 if exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Change your temporary password first'; end if;
 snapshot=public.dashboard_snapshot();
 minutes=case when snapshot#>>'{today,checkIn}' is null then 0 else greatest(0,floor(extract(epoch from(coalesce((snapshot#>>'{today,checkOut}')::timestamptz,now())-(snapshot#>>'{today,checkIn}')::timestamptz))/60)::integer) end;
 return jsonb_set(snapshot,'{today}',(snapshot->'today')||jsonb_build_object('serverNow',now(),'durationMinutes',minutes));
end $$;
revoke all on function public.dashboard_snapshot_v2() from public,anon;
grant execute on function public.dashboard_snapshot_v2() to authenticated;
