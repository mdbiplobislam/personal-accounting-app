-- Minimal stand-in for the parts of Supabase's `auth` schema that the migrations use.
--
-- Used ONLY when running the migrations on a plain PostgreSQL server (scripts/db-test.sh
-- and the CI database job). Supabase provides all of this natively, and every statement
-- here is guarded so it does nothing on a real Supabase database.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid
      language sql stable
      as $f$
        select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
      $f$;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
