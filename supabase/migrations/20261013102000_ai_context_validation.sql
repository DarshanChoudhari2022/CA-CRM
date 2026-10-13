create function public.ca_validate_context()
returns trigger language plpgsql set search_path=public as $$
begin
 if jsonb_typeof(new.sources)<>'array' or jsonb_array_length(new.sources)>120 or octet_length(new.sources::text)>120000 then raise exception 'Invalid evidence snapshot'; end if;
 if exists(select 1 from jsonb_array_elements(new.sources) s where jsonb_typeof(s)<>'object'
  or jsonb_typeof(s->'id') is distinct from 'string' or length(s->>'id') not between 1 and 100
  or jsonb_typeof(s->'title') is distinct from 'string' or length(s->>'title') not between 1 and 200
  or jsonb_typeof(s->'content') is distinct from 'string' or length(s->>'content') not between 1 and 8000
  or (s ? 'url' and (jsonb_typeof(s->'url') is distinct from 'string' or (s->>'url') !~ '^https://[^[:space:]]+$'))) then raise exception 'Evidence must contain a valid ID, title, content and optional HTTPS link'; end if;
 return new;
end $$;
revoke all on function public.ca_validate_context() from public,anon,authenticated;
create trigger ca_context_shape before insert or update of sources on public.ca_agent_jobs for each row execute function public.ca_validate_context();
