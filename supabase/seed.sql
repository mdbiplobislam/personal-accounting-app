-- Seed data for LOCAL DEVELOPMENT AND TESTS ONLY.
--
-- Every person, account, amount and date below is fictional. Do not replace these
-- with real financial records, and do not commit real exports into this file.
--
-- The demo user cannot sign in until a password is set for it in the local Supabase
-- Studio (Authentication > Users). The profile and the default categories are created by
-- the handle_new_user() trigger, exactly as they are for a real signup.

-- Keep the RPC result rows out of the console output.
\o /dev/null

-- Demo user (fictional address, fixed UUID so tests and screenshots are repeatable).
insert into auth.users (id, email)
values ('d0000000-0000-4000-8000-000000000001', 'demo@example.com')
on conflict (id) do nothing;

-- Act as the demo user so the production RPCs (and their ownership checks) run here too.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', false);

insert into public.accounts (id, user_id, name, type, opening_balance) values
  ('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000001', 'Demo Cash', 'cash', 40000.00),
  ('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000001', 'Demo Bank', 'bank', 120000.00),
  ('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-000000000001', 'Demo bKash', 'bkash', 3000.00),
  ('d0000000-0000-4000-8000-0000000000a4', 'd0000000-0000-4000-8000-000000000001', 'Demo Credit Card', 'credit_card', 0.00);

-- Income and expenses. Keys are fixed so re-running the seed on the same DB is harmless.
select public.create_transaction('d0000000-0000-4000-8000-0000000000a2', 'income', 80000.00, '2026-03-01',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Salary'),
  'March salary', 'e0000000-0000-4000-8000-000000000001');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a2', 'expense', 25000.00, '2026-03-02',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Rent'),
  'March rent', 'e0000000-0000-4000-8000-000000000002');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a1', 'expense', 6500.00, '2026-03-05',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Food'),
  'Groceries', 'e0000000-0000-4000-8000-000000000003');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a3', 'expense', 500.00, '2026-03-06',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Mobile recharge'),
  'Mobile recharge', 'e0000000-0000-4000-8000-000000000004');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a4', 'expense', 4200.00, '2026-03-12',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Shopping'),
  'Online order', 'e0000000-0000-4000-8000-000000000005');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a4', 'refund', 700.00, '2026-03-14',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Shopping'),
  'Returned item', 'e0000000-0000-4000-8000-000000000006');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a1', 'expense', 1800.00, '2026-03-15',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Transport'),
  'Ride share', 'e0000000-0000-4000-8000-000000000007');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a2', 'income', 15000.00, '2026-03-20',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Business'),
  'Freelance project', 'e0000000-0000-4000-8000-000000000008');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a2', 'expense', 3200.00, '2026-03-22',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Utilities'),
  'Electricity and water', 'e0000000-0000-4000-8000-000000000009');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a2', 'income', 80000.00, '2026-04-01',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Salary'),
  'April salary', 'e0000000-0000-4000-8000-00000000000a');
select public.create_transaction('d0000000-0000-4000-8000-0000000000a1', 'expense', 7000.00, '2026-04-04',
  (select id from public.categories where user_id = 'd0000000-0000-4000-8000-000000000001' and name = 'Food'),
  'Groceries', 'e0000000-0000-4000-8000-00000000000b');

-- Transfer between own accounts: not income and not expense.
select public.create_transfer('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a3', 5000.00,
  '2026-03-07', 'Top up bKash', 'e0000000-0000-4000-8000-00000000000c');

-- Loans. The given loan moves cash out of Demo Cash; the received loan moves cash into bKash.
select public.create_loan('given', 'Sample Friend A', 10000.00, '2026-03-10',
  '2026-06-30', 'd0000000-0000-4000-8000-0000000000a1', 'Short-term help', 'e0000000-0000-4000-8000-00000000000d');
select public.create_loan('received', 'Sample Lender B', 20000.00, '2026-03-18',
  '2026-09-30', 'd0000000-0000-4000-8000-0000000000a3', 'Fictional emergency loan', 'e0000000-0000-4000-8000-00000000000e');

-- Repayments: principal reduces outstanding; interest is income on the given loan.
select public.record_loan_repayment(
  (select id from public.loans where user_id = 'd0000000-0000-4000-8000-000000000001' and counterparty = 'Sample Friend A'),
  'd0000000-0000-4000-8000-0000000000a1', 2000.00, 100.00, '2026-04-10', 'e0000000-0000-4000-8000-00000000000f');
select public.record_loan_repayment(
  (select id from public.loans where user_id = 'd0000000-0000-4000-8000-000000000001' and counterparty = 'Sample Lender B'),
  'd0000000-0000-4000-8000-0000000000a3', 5000.00, 0.00, '2026-04-12', 'e0000000-0000-4000-8000-000000000010');

-- Budgets and a savings goal.
insert into public.budgets (user_id, category_id, month, amount)
select 'd0000000-0000-4000-8000-000000000001', c.id, m.month, m.amount
from (values
  ('Food', date '2026-03-01', 8000.00),
  ('Shopping', date '2026-03-01', 3000.00),
  ('Transport', date '2026-03-01', 2500.00)
) as m(category_name, month, amount)
join public.categories c
  on c.user_id = 'd0000000-0000-4000-8000-000000000001' and c.name = m.category_name;

insert into public.savings_goals (user_id, name, target_amount, saved_amount, target_date) values
  ('d0000000-0000-4000-8000-000000000001', 'Emergency fund (demo)', 300000.00, 45000.00, '2027-12-31');

select set_config('request.jwt.claims', '', false);

\o
