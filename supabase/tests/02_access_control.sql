-- Access control tests. Each check runs as a real `authenticated` role with JWT claims,
-- the same way PostgREST and supabase-js reach the database. Runs in one transaction
-- and rolls back.
--
-- Users: Alice ('aaaaaaaa-...') and Bob ('bbbbbbbb-...'). The demo user from seed.sql is
-- used to prove that other users' data is invisible.

begin;

create function pg_temp.fails(label text, stmt text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS (rejected): %', label;
    return;
  end;
  raise exception 'FAILED %: statement was accepted', label;
end;
$$;

create function pg_temp.eq_text(actual text, expected text, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAILED %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'PASS: %', label;
end;
$$;

create function pg_temp.as_user(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create function pg_temp.as_admin()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end;
$$;

create function pg_temp.as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end;
$$;

-- Runs a DML statement and returns how many rows it touched.
create function pg_temp.affected(stmt text)
returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (created as admin)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bob@example.test');

select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.accounts (id, user_id, name, type, opening_balance) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Alice Wallet', 'cash', 100);
select public.create_loan('given', 'Alice borrower', 500, '2026-03-01', null,
  'aaaaaaaa-0000-4000-8000-0000000000c1', null, '30000000-0000-4000-8000-000000000001');
select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 1000, '2026-03-02', null,
  'Alice income', '30000000-0000-4000-8000-000000000002');

-- Real ids that Bob must not be able to use. Readable by everyone, so a rejection below
-- can only come from the ownership checks, not from a missing grant or a NULL lookup.
select pg_temp.as_admin();
create temp table fx (key text primary key, id uuid);
grant select on fx to public;
insert into fx values
  ('alice_loan', (select id from public.loans where user_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('bob_category', (select id from public.categories where user_id = 'bbbbbbbb-0000-4000-8000-000000000002' and name = 'Food'));

select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
insert into public.accounts (id, user_id, name, type, opening_balance) values
  ('bbbbbbbb-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-000000000002', 'Bob Bank', 'bank', 999);

-- ---------------------------------------------------------------------------
-- Bob cannot see Alice's data
-- ---------------------------------------------------------------------------
select pg_temp.eq_text((select count(*) from public.accounts
  where user_id = 'aaaaaaaa-0000-4000-8000-000000000001')::text, '0', 'Bob sees none of Alice accounts');
select pg_temp.eq_text((select count(*) from public.transactions)::text, '0', 'Bob sees no transactions at all');
select pg_temp.eq_text((select count(*) from public.loans)::text, '0', 'Bob sees no loans');
select pg_temp.eq_text((select count(*) from public.loan_repayments)::text, '0', 'Bob sees no repayments');
-- Bob's own audit rows (his signup categories and account) are visible; nobody else's are.
select pg_temp.eq_text((select count(*) from public.audit_logs
  where user_id is distinct from 'bbbbbbbb-0000-4000-8000-000000000002')::text, '0', 'Bob sees no audit rows of other users');
select pg_temp.eq_text((select count(*) from public.account_balances)::text, '1', 'Bob balance view shows only own account');
select pg_temp.eq_text((select count(*) from public.profiles)::text, '1', 'Bob sees only his own profile');
select pg_temp.eq_text((select count(*) from public.categories)::text, '13', 'Bob sees only his own categories');

-- ---------------------------------------------------------------------------
-- Bob cannot change Alice's data (updates and deletes match zero rows)
-- ---------------------------------------------------------------------------
select pg_temp.eq_text(pg_temp.affected(
  $q$update public.accounts set name = 'hacked' where id = 'aaaaaaaa-0000-4000-8000-0000000000c1'$q$)::text,
  '0', 'Bob cannot rename Alice account');
select pg_temp.eq_text(pg_temp.affected(
  $q$delete from public.categories where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$)::text,
  '0', 'Bob cannot delete Alice categories');
select pg_temp.eq_text(pg_temp.affected(
  $q$update public.profiles set display_name = 'hacked' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$)::text,
  '0', 'Bob cannot edit Alice profile');

-- Bob cannot write into Alice's account through any path.
select pg_temp.fails('Bob cannot insert a transaction into Alice account (direct)',
  $q$insert into public.transactions (user_id, account_id, type, amount, idempotency_key)
     values ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 1, '40000000-0000-4000-8000-000000000001')$q$);
select pg_temp.fails('Bob cannot create_transaction on Alice account',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 1, '2026-03-01', null, null, '40000000-0000-4000-8000-000000000002')$q$);
select pg_temp.fails('Bob cannot transfer out of Alice account',
  $q$select public.create_transfer('aaaaaaaa-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-0000000000c1', 1, '2026-03-01', null, '40000000-0000-4000-8000-000000000003')$q$);
select pg_temp.fails('Bob cannot repay Alice loan',
  $q$select public.record_loan_repayment((select id from fx where key = 'alice_loan'), 'bbbbbbbb-0000-4000-8000-0000000000c1', 1, 0, '2026-03-01', '40000000-0000-4000-8000-000000000004')$q$);
select pg_temp.fails('Bob cannot create a loan against Alice account',
  $q$select public.create_loan('given', 'x', 1, '2026-03-01', null, 'aaaaaaaa-0000-4000-8000-0000000000c1', null, '40000000-0000-4000-8000-000000000005')$q$);
-- Idempotency keys are scoped per user: Bob reusing Alice's key gets a new row owned by Bob,
-- and never Alice's row back.
select pg_temp.eq_text((select (public.create_transaction('bbbbbbbb-0000-4000-8000-0000000000c1', 'income', 1,
  '2026-03-01', null, null, '30000000-0000-4000-8000-000000000002')).user_id)::text,
  'bbbbbbbb-0000-4000-8000-000000000002', 'idempotency keys are scoped per user');

-- ---------------------------------------------------------------------------
-- Alice cannot forge rows owned by someone else or point at Bob's account
-- ---------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.fails('Alice cannot insert a row claiming Bob user_id',
  $q$insert into public.accounts (user_id, name, type) values ('bbbbbbbb-0000-4000-8000-000000000002', 'Spoof', 'cash')$q$);
select pg_temp.fails('Alice cannot transact on Bob account',
  $q$select public.create_transaction('bbbbbbbb-0000-4000-8000-0000000000c1', 'income', 1, '2026-03-01', null, null, '50000000-0000-4000-8000-000000000001')$q$);
select pg_temp.fails('Alice cannot categorise with Bob category (composite FK)',
  $q$insert into public.transactions (user_id, account_id, category_id, type, amount, idempotency_key)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000c1',
             (select id from fx where key = 'bob_category'),
             'income', 1, '50000000-0000-4000-8000-000000000002')$q$);

-- Alice sees exactly her own rows.
select pg_temp.eq_text((select count(*) from public.accounts)::text, '1', 'Alice sees only her own account');
select pg_temp.eq_text((select count(*) from public.loans)::text, '1', 'Alice sees her own loan');

-- ---------------------------------------------------------------------------
-- Loan trail and audit are read-only for clients
-- ---------------------------------------------------------------------------
select pg_temp.fails('client cannot insert loan repayment row directly',
  $q$insert into public.loan_repayments (user_id, loan_id, account_id, transaction_id, principal_amount, idempotency_key)
     values ('aaaaaaaa-0000-4000-8000-000000000001', (select id from public.loans limit 1),
             'aaaaaaaa-0000-4000-8000-0000000000c1', (select id from public.transactions where loan_id is not null limit 1),
             1, '50000000-0000-4000-8000-000000000003')$q$);
select pg_temp.fails('client cannot write audit logs',
  $q$insert into public.audit_logs (user_id, table_name, action) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x', 'INSERT')$q$);
select pg_temp.fails('client cannot delete audit logs',
  $q$delete from public.audit_logs$q$);

-- Loan-linked transactions cannot be altered or removed by the client.
select pg_temp.eq_text(pg_temp.affected(
  $q$update public.transactions set amount = 1 where loan_id is not null$q$)::text,
  '0', 'loan-linked transactions cannot be updated by client');
select pg_temp.eq_text(pg_temp.affected(
  $q$delete from public.transactions where loan_id is not null$q$)::text,
  '0', 'loan-linked transactions cannot be deleted by client');

-- Alice cannot promote a regular transaction into a loan movement.
select pg_temp.fails('client cannot retype an income into a loan movement',
  $q$update public.transactions set type = 'loan_in', loan_id = (select id from public.loans limit 1)
     where type = 'income'$q$);

-- ---------------------------------------------------------------------------
-- Anonymous visitors get nothing
-- ---------------------------------------------------------------------------
select pg_temp.as_anon();
select pg_temp.fails('anon cannot read accounts', $q$select 1 from public.accounts$q$);
select pg_temp.fails('anon cannot read balances', $q$select 1 from public.account_balances$q$);
select pg_temp.fails('anon cannot call create_transaction',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 1, '2026-03-01', null, null, '60000000-0000-4000-8000-000000000001')$q$);
select pg_temp.fails('anon cannot call the report',
  $q$select 1 from public.report_monthly_summary(2026)$q$);

-- Without claims, auth.uid() is null, so the RPCs refuse the call even for a valid role.
select pg_temp.as_admin();
select pg_temp.fails('no-claims call to create_transaction is refused',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 1, '2026-03-01', null, null, '60000000-0000-4000-8000-000000000002')$q$);

rollback;
