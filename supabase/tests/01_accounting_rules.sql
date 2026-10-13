-- Accounting rule tests. Runs in one transaction and rolls back, so it leaves no data.
-- Each step asserts an exact expected balance, so a wrong sign or a double count fails loudly.
--
-- Fixture user A = 'aaaaaaaa-...'. Amounts are chosen so that every expected value is
-- easy to check by hand (see the ledger comments below).

begin;

-- ---------------------------------------------------------------------------
-- Test helpers (temporary, vanish at the end of the session)
-- ---------------------------------------------------------------------------
create function pg_temp.eq(actual numeric, expected numeric, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAILED %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'PASS: %', label;
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

-- Passes only if the statement raises an error.
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

create function pg_temp.bal(p_account uuid)
returns numeric language sql as $$
  select current_balance from public.account_balances where account_id = p_account;
$$;

create function pg_temp.cat(p_user uuid, p_name text)
returns uuid language sql as $$
  select id from public.categories where user_id = p_user and name = p_name;
$$;

create function pg_temp.loan_id(p_user uuid, p_name text)
returns uuid language sql as $$
  select id from public.loans where user_id = p_user and counterparty = p_name;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bob@example.test');

select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');

insert into public.accounts (id, user_id, name, type, opening_balance) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Wallet', 'cash', 1000),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000001', 'Bank', 'bank', 500),
  ('aaaaaaaa-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-4000-8000-000000000001', 'bKash', 'bkash', 500),
  ('aaaaaaaa-0000-4000-8000-0000000000c4', 'aaaaaaaa-0000-4000-8000-000000000001', 'Card', 'credit_card', 0);

-- ---------------------------------------------------------------------------
-- Ledger walk-through (A's view). Expected balances after each step:
--   Wallet 1000 -> 6000 (salary) -> 5700 (food) -> 5750 (refund) -> 5550 (to bKash)
--   -> 3550 (loan given) -> 4100 (repayment in: 500 principal + 50 interest)
--   -> 4200 (principal-only repayment)
--   Bank 500 (untouched)
--   bKash 500 -> 700 (from Wallet) -> 300 (paid to card) -> 3300 (loan received)
--   -> 300 (loan repaid)
--   Card 0 -> -1000 (shopping) -> -600 (payment received)
-- ---------------------------------------------------------------------------
select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 5000.00, '2026-03-01',
  pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Salary'), 'Pay', '10000000-0000-4000-8000-000000000001');
select pg_temp.as_admin();
select pg_temp.eq(pg_temp.bal('aaaaaaaa-0000-4000-8000-0000000000c1'), 6000, 'income increases the account');
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');

select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'expense', 300.00, '2026-03-05',
  pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Food'), 'Groceries', '10000000-0000-4000-8000-000000000002');

select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'refund', 50.00, '2026-03-06',
  pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Food'), 'Refund of groceries', '10000000-0000-4000-8000-000000000003');

select public.create_transfer('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c3',
  200.00, '2026-03-07', 'Top up', '10000000-0000-4000-8000-000000000004');

select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c4', 'expense', 1000.00, '2026-03-08',
  pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Shopping'), 'Laptop bag', '10000000-0000-4000-8000-000000000005');

select public.create_transfer('aaaaaaaa-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-4000-8000-0000000000c4',
  400.00, '2026-03-09', 'Card payment', '10000000-0000-4000-8000-000000000006');

select public.create_loan('given', 'Rahim', 2000.00, '2026-03-10', null,
  'aaaaaaaa-0000-4000-8000-0000000000c1', 'Test loan out', '10000000-0000-4000-8000-000000000007');

select public.create_loan('received', 'Karim', 3000.00, '2026-03-11', null,
  'aaaaaaaa-0000-4000-8000-0000000000c3', 'Test loan in', '10000000-0000-4000-8000-000000000008');

select public.record_loan_repayment(pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Rahim'),
  'aaaaaaaa-0000-4000-8000-0000000000c1', 500.00, 50.00, '2026-03-12', '10000000-0000-4000-8000-000000000009');

select public.record_loan_repayment(pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Karim'),
  'aaaaaaaa-0000-4000-8000-0000000000c3', 3000.00, 0.00, '2026-03-13', '10000000-0000-4000-8000-00000000000a');

-- Principal-only repayment of the given loan, submitted twice with the same key.
select public.record_loan_repayment(pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Rahim'),
  'aaaaaaaa-0000-4000-8000-0000000000c1', 100.00, 0.00, '2026-03-14', '10000000-0000-4000-8000-00000000000b');
select public.record_loan_repayment(pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Rahim'),
  'aaaaaaaa-0000-4000-8000-0000000000c1', 100.00, 0.00, '2026-03-14', '10000000-0000-4000-8000-00000000000b');

-- Replayed income submit with a different amount must return the original row, not insert.
select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 9999.00, '2026-03-01',
  pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Salary'), 'Pay (retry)', '10000000-0000-4000-8000-000000000001');

select pg_temp.as_admin();

select pg_temp.eq(pg_temp.bal('aaaaaaaa-0000-4000-8000-0000000000c1'), 4200, 'Wallet balance after full ledger walk');
select pg_temp.eq(pg_temp.bal('aaaaaaaa-0000-4000-8000-0000000000c2'), 500, 'Bank untouched');
select pg_temp.eq(pg_temp.bal('aaaaaaaa-0000-4000-8000-0000000000c3'), 300, 'bKash after transfers and loans');
select pg_temp.eq(pg_temp.bal('aaaaaaaa-0000-4000-8000-0000000000c4'), -600, 'Credit card owes 600 after payment');

select pg_temp.eq((select count(*) from public.transactions
  where idempotency_key = '10000000-0000-4000-8000-000000000001'), 1, 'idempotent replay inserts no duplicate');

select pg_temp.eq((select count(*) from public.loan_repayments
  where idempotency_key = '10000000-0000-4000-8000-00000000000b'), 1, 'idempotent repayment inserts one row');

select pg_temp.eq((select outstanding_principal from public.loans
  where counterparty = 'Rahim'), 1400, 'principal repayments reduce outstanding (2000-500-100)');

select pg_temp.eq((select outstanding_principal from public.loans
  where counterparty = 'Karim'), 0, 'fully repaid loan has zero outstanding');

select pg_temp.eq_text((select status::text from public.loans where counterparty = 'Karim'), 'settled',
  'fully repaid loan is marked settled');

-- ---------------------------------------------------------------------------
-- Reports: transfers, loan principal and loan proceeds must not be income or expense.
--   income   = 5000                              (salary only)
--   interest = 50                                (interest on the given loan)
--   expense  = 300 food + 1000 shopping          = 1300
--   refunds  = 50
--   net expense = 1300 - 50 = 1250
--   net savings = (5000 + 50) - 1250 = 3800
-- ---------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.eq((select income from public.report_monthly_summary(2026) where month = 3), 5000, 'report income excludes transfers and loans');
select pg_temp.eq((select interest_income from public.report_monthly_summary(2026) where month = 3), 50, 'loan interest is income');
select pg_temp.eq((select expense from public.report_monthly_summary(2026) where month = 3), 1300, 'report expense excludes transfers and loan principal');
select pg_temp.eq((select refunds from public.report_monthly_summary(2026) where month = 3), 50, 'refunds reported separately');
select pg_temp.eq((select net_expense from public.report_monthly_summary(2026) where month = 3), 1250, 'net expense = expense - refunds');
select pg_temp.eq((select net_savings from public.report_monthly_summary(2026) where month = 3), 3800, 'net savings');
select pg_temp.eq((select total_income from public.report_monthly_summary(2026) where month = 3), 5050, 'total income = income + interest');

-- Budget: Food limit 250 for March, spent = 300 - 50 = 250.
insert into public.budgets (user_id, category_id, month, amount) values
  ('aaaaaaaa-0000-4000-8000-000000000001', pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Food'), '2026-03-01', 250);
select pg_temp.eq((select spent from public.budget_status where category_name = 'Food' and month = '2026-03-01'),
  250, 'budget spent nets refunds');

-- Audit trail records the writes made by this test.
select pg_temp.eq_text(
  ((select count(*) > 0 from public.audit_logs where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'))::text,
  'true', 'audit_logs records writes');

-- ---------------------------------------------------------------------------
-- Rejected operations
-- ---------------------------------------------------------------------------
select pg_temp.fails('zero amount rejected',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 0, '2026-03-01', null, null, '20000000-0000-4000-8000-000000000001')$q$);
select pg_temp.fails('negative amount rejected',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'expense', -5, '2026-03-01', null, null, '20000000-0000-4000-8000-000000000002')$q$);
select pg_temp.fails('loan type cannot go through create_transaction',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'loan_in', 5, '2026-03-01', null, null, '20000000-0000-4000-8000-000000000003')$q$);
select pg_temp.fails('income cannot use expense category',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 5, '2026-03-01', pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Food'), null, '20000000-0000-4000-8000-000000000004')$q$);
select pg_temp.fails('expense cannot use income category',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'expense', 5, '2026-03-01', pg_temp.cat('aaaaaaaa-0000-4000-8000-000000000001', 'Salary'), null, '20000000-0000-4000-8000-000000000005')$q$);
select pg_temp.fails('transfer to same account rejected',
  $q$select public.create_transfer('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1', 5, '2026-03-01', null, '20000000-0000-4000-8000-000000000006')$q$);
select pg_temp.fails('overpayment of loan principal rejected',
  $q$select public.record_loan_repayment(pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Rahim'), 'aaaaaaaa-0000-4000-8000-0000000000c1', 1401, 0, '2026-03-20', '20000000-0000-4000-8000-000000000007')$q$);
select pg_temp.fails('repayment on settled loan rejected',
  $q$select public.record_loan_repayment(pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Karim'), 'aaaaaaaa-0000-4000-8000-0000000000c3', 1, 0, '2026-03-20', '20000000-0000-4000-8000-000000000008')$q$);
select pg_temp.fails('zero repayment rejected',
  $q$select public.record_loan_repayment(pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Rahim'), 'aaaaaaaa-0000-4000-8000-0000000000c1', 0, 0, '2026-03-20', '20000000-0000-4000-8000-000000000009')$q$);
select pg_temp.fails('missing idempotency key rejected',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c1', 'income', 5, '2026-03-01', null, null, null)$q$);
select pg_temp.fails('loan-linked transaction cannot be inserted directly',
  $q$insert into public.transactions (user_id, account_id, loan_id, type, amount, idempotency_key)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000c1',
             pg_temp.loan_id('aaaaaaaa-0000-4000-8000-000000000001', 'Rahim'), 'loan_in', 1, '20000000-0000-4000-8000-00000000000a')$q$);

-- Archived accounts take no new money movements.
select pg_temp.as_admin();
update public.accounts set is_archived = true where id = 'aaaaaaaa-0000-4000-8000-0000000000c4';
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.fails('archived account rejects new transactions',
  $q$select public.create_transaction('aaaaaaaa-0000-4000-8000-0000000000c4', 'expense', 5, '2026-03-01', null, null, '20000000-0000-4000-8000-00000000000b')$q$);

-- Loan rows are immutable from the client side.
select pg_temp.fails('client cannot edit loan principal directly',
  $q$update public.loans set principal = 999999 where counterparty = 'Rahim'$q$);

-- Case-insensitive duplicate account names are rejected per user.
select pg_temp.fails('duplicate account name (case-insensitive) rejected',
  $q$insert into public.accounts (user_id, name, type) values ('aaaaaaaa-0000-4000-8000-000000000001', 'WALLET', 'cash')$q$);

select pg_temp.as_admin();
select pg_temp.eq(pg_temp.bal('aaaaaaaa-0000-4000-8000-0000000000c1'), 4200, 'rejected operations left balances unchanged');

rollback;
