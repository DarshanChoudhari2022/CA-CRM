alter table public.profiles add column password_change_required boolean not null default false;

create function public.link_employee_account(p_employee uuid, p_user uuid, p_actor uuid)
returns void language plpgsql security definer set search_path=public,auth as $$
declare e public.employees;
begin
  select * into e from public.employees where id=p_employee for update;
  if e.id is null or not e.active or e.profile_user_id is not null then
    raise exception 'Employee is inactive or already has an account';
  end if;
  if not exists(select 1 from public.profiles where user_id=p_actor and active and organization_id=e.organization_id and role in ('admin','partner')) then
    raise exception 'Administrator access required';
  end if;
  if not exists(select 1 from auth.users where id=p_user and lower(email)=lower(e.work_email::text)) then
    raise exception 'Account email does not match employee';
  end if;
  insert into public.profiles(user_id,organization_id,employee_id,full_name,role,password_change_required)
  values(p_user,e.organization_id,e.id,e.full_name,'employee',true);
  update public.employees set profile_user_id=p_user,updated_at=now() where id=e.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
  values(e.organization_id,p_actor,'account_created','employee',e.id::text,gen_random_uuid());
end $$;
revoke all on function public.link_employee_account(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_employee_account(uuid,uuid,uuid) to service_role;

create function public.on_employee_password_changed()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set password_change_required=false where user_id=new.id;
  end if;
  return new;
end $$;
revoke all on function public.on_employee_password_changed() from public,anon,authenticated;
create trigger employee_password_changed after update of encrypted_password on auth.users
for each row execute function public.on_employee_password_changed();

create table public.daily_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  title text not null check(length(trim(title)) between 1 and 200),
  notes text not null default '' check(length(notes)<=2000),
  status text not null default 'planned' check(status in ('planned','in_progress','completed','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index daily_work_employee_date on public.daily_work_items(employee_id,work_date);
alter table public.daily_work_items enable row level security;
create policy work_read on public.daily_work_items for select to authenticated
using(organization_id=public.current_organization_id() and public.can_view_employee(employee_id));
grant select on public.daily_work_items to authenticated;

create function public.save_daily_work(p_id uuid,p_title text,p_notes text,p_status text)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare e public.employees; v_id uuid; v_date date;
begin
  select * into e from public.employees where id=public.current_employee_id() and active;
  if e.id is null then raise exception 'Active employee access required'; end if;
  if exists(select 1 from public.profiles where user_id=auth.uid() and password_change_required) then raise exception 'Change your password first'; end if;
  if length(trim(p_title)) not between 1 and 200 or length(p_notes)>2000 or p_status not in ('planned','in_progress','completed','blocked') then raise exception 'Invalid work item'; end if;
  v_date=(now() at time zone 'Asia/Kolkata')::date;
  if p_id is null then
    insert into public.daily_work_items(organization_id,employee_id,work_date,title,notes,status)
    values(e.organization_id,e.id,v_date,trim(p_title),p_notes,p_status) returning id into v_id;
  else
    update public.daily_work_items set title=trim(p_title),notes=p_notes,status=p_status,updated_at=now()
    where id=p_id and employee_id=e.id and work_date=v_date returning id into v_id;
    if v_id is null then raise exception 'Only your work for today can be updated'; end if;
  end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
  values(e.organization_id,auth.uid(),'work_saved','daily_work_item',v_id::text,gen_random_uuid());
  return v_id;
end $$;
revoke all on function public.save_daily_work(uuid,text,text,text) from public,anon;
grant execute on function public.save_daily_work(uuid,text,text,text) to authenticated;
