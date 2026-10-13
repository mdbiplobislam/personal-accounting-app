-- Migration 005: derived views, reporting and atomic accounting RPCs.
--
-- Accounting rules implemented here (see docs/ACCOUNTING_RULES.md)
--   1. income  -> money in,  counts as income.
--   2. expense -> money out, counts as expense.
--   3. refund  -> money in,  reduces expense. Never income.
--   4. transfer -> moves money between own accounts. Never income or expense.
--   5. loan_out / loan_in -> cash movement only. Never income or expense.
--   6. loan_repayment_* -> reduces outstanding principal. Interest is income (given) or
--      expense (received). Principal is never income or expense.
--   7. Balance = opening_balance + signed transactions + transfers in - transfers out.
--
-- Write RPCs are SECURITY DEFINER so they can insert loan-linked rows that the client
-- RLS policies deliberately forbid. Each one checks auth.uid() and ownership itself.

-- ---------------------------------------------------------------------------
-- Views (security_invoker so the caller's RLS applies to every underlying table)
-- ---------------------------------------------------------------------------
create view public.account_balances
with (security_invoker = true) as
select
  a.id as account_id,
  a.user_id,
  a.name,
  a.type,
  a.currency,
  a.is_archived,
  a.opening_balance,
  a.opening_balance
    + coalesce((select sum(t.signed_amount) from public.transactions t where t.account_id = a.id), 0)
    + coalesce((select sum(tr.amount) from public.transfers tr where tr.to_account_id = a.id), 0)
    - coalesce((select sum(tr.amount) from public.transfers tr where tr.from_account_id = a.id), 0)
    as current_balance
from public.accounts a;

create view public.budget_status
with (security_invoker = true) as
select
  b.id as budget_id,
  b.user_id,
  b.category_id,
  c.name as category_name,
  b.month,
  b.amount as budget_amount,
  coalesce((
    select sum(case when t.type = 'expense' then t.amount else -t.amount end)
    from public.transactions t
    where t.user_id = b.user_id
      and t.category_id = b.category_id
      and t.type in ('expense', 'refund')
      and t.occurred_on >= b.month
      and t.occurred_on < (b.month + interval '1 month')::date
  ), 0) as spent
from public.budgets b
join public.categories c on c.id = b.category_id and c.user_id = b.user_id;

grant select on public.account_balances to authenticated;
grant select on public.budget_status to authenticated;

-- ---------------------------------------------------------------------------
-- Monthly report for one calendar year. Returns 12 rows, one per month.
-- Runs as the caller (invoker), so RLS limits it to the caller's own data.
-- ---------------------------------------------------------------------------
create or replace function public.report_monthly_summary(p_year int)
returns table (
  month int,
  income numeric,
  interest_income numeric,
  expense numeric,
  refunds numeric,
  interest_expense numeric,
  total_income numeric,
  net_expense numeric,
  net_savings numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tx as (
    select extract(month from t.occurred_on)::int as m, t.type, t.amount
    from public.transactions t
    where extract(year from t.occurred_on)::int = p_year
      and t.type in ('income', 'expense', 'refund')
  ),
  intr as (
    select extract(month from r.paid_on)::int as m, l.direction, r.interest_amount
    from public.loan_repayments r
    join public.loans l on l.id = r.loan_id and l.user_id = r.user_id
    where extract(year from r.paid_on)::int = p_year
  ),
  base as (
    select
      mo.m,
      coalesce((select sum(tx.amount) from tx where tx.m = mo.m and tx.type = 'income'), 0) as income,
      coalesce((select sum(intr.interest_amount) from intr
                where intr.m = mo.m and intr.direction = 'given'), 0) as interest_income,
      coalesce((select sum(tx.amount) from tx where tx.m = mo.m and tx.type = 'expense'), 0) as expense,
      coalesce((select sum(tx.amount) from tx where tx.m = mo.m and tx.type = 'refund'), 0) as refunds,
      coalesce((select sum(intr.interest_amount) from intr
                where intr.m = mo.m and intr.direction = 'received'), 0) as interest_expense
    from generate_series(1, 12) as mo(m)
  )
  select
    b.m as month,
    b.income,
    b.interest_income,
    b.expense,
    b.refunds,
    b.interest_expense,
    b.income + b.interest_income as total_income,
    b.expense + b.interest_expense - b.refunds as net_expense,
    (b.income + b.interest_income) - (b.expense + b.interest_expense - b.refunds) as net_savings
  from base b
  order by b.m;
$$;

grant execute on function public.report_monthly_summary(int) to authenticated;

-- ---------------------------------------------------------------------------
-- create_transaction: income, expense or refund. Idempotent on p_idempotency_key.
-- ---------------------------------------------------------------------------
create or replace function public.create_transaction(
  p_account_id uuid,
  p_type public.transaction_type,
  p_amount numeric,
  p_occurred_on date,
  p_category_id uuid,
  p_description text,
  p_idempotency_key uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.transactions;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_type not in ('income', 'expense', 'refund') then
    raise exception 'use the loan functions for loan movements' using errcode = '22023';
  end if;

  -- Replayed submit: return the original row untouched.
  select * into v_row
  from public.transactions t
  where t.user_id = v_uid and t.idempotency_key = p_idempotency_key;
  if found then
    return v_row;
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.user_id = v_uid and not a.is_archived
  ) then
    raise exception 'account not found or archived' using errcode = 'P0002';
  end if;

  insert into public.transactions (
    user_id, account_id, category_id, type, amount, occurred_on, description, idempotency_key
  )
  values (
    v_uid, p_account_id, p_category_id, p_type, p_amount,
    coalesce(p_occurred_on, current_date), nullif(btrim(p_description), ''), p_idempotency_key
  )
  on conflict on constraint transactions_idempotency_key do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.transactions t
    where t.user_id = v_uid and t.idempotency_key = p_idempotency_key;
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_transfer: moves money between two of the caller's accounts. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.create_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_transferred_on date,
  p_note text,
  p_idempotency_key uuid
)
returns public.transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.transfers;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select * into v_row from public.transfers t
  where t.user_id = v_uid and t.idempotency_key = p_idempotency_key;
  if found then
    return v_row;
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception 'from and to accounts must differ' using errcode = '23514';
  end if;
  if (select count(*) from public.accounts a
      where a.user_id = v_uid and a.id in (p_from_account_id, p_to_account_id) and not a.is_archived) <> 2 then
    raise exception 'both accounts must exist and be active' using errcode = 'P0002';
  end if;

  insert into public.transfers (
    user_id, from_account_id, to_account_id, amount, transferred_on, note, idempotency_key
  )
  values (
    v_uid, p_from_account_id, p_to_account_id, p_amount,
    coalesce(p_transferred_on, current_date), nullif(btrim(p_note), ''), p_idempotency_key
  )
  on conflict on constraint transfers_idempotency_key do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.transfers t
    where t.user_id = v_uid and t.idempotency_key = p_idempotency_key;
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_loan: records a loan and, when an account is given, the cash movement.
--   given    -> loan_out (cash leaves the account; not an expense)
--   received -> loan_in  (cash enters the account; not income)
-- ---------------------------------------------------------------------------
create or replace function public.create_loan(
  p_direction public.loan_direction,
  p_counterparty text,
  p_principal numeric,
  p_start_date date,
  p_due_date date,
  p_account_id uuid,
  p_notes text,
  p_idempotency_key uuid
)
returns public.loans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_loan public.loans;
  v_start date := coalesce(p_start_date, current_date);
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select * into v_loan from public.loans l
  where l.user_id = v_uid and l.idempotency_key = p_idempotency_key;
  if found then
    return v_loan;
  end if;

  if p_account_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.user_id = v_uid and not a.is_archived
  ) then
    raise exception 'account not found or archived' using errcode = 'P0002';
  end if;

  insert into public.loans (
    user_id, direction, counterparty, principal, outstanding_principal,
    start_date, due_date, notes, idempotency_key
  )
  values (
    v_uid, p_direction, btrim(p_counterparty), p_principal, p_principal,
    v_start, p_due_date, nullif(btrim(p_notes), ''), p_idempotency_key
  )
  returning * into v_loan;

  if p_account_id is not null then
    insert into public.transactions (
      user_id, account_id, loan_id, type, amount, occurred_on, description, idempotency_key
    )
    values (
      v_uid, p_account_id, v_loan.id,
      case when p_direction = 'given' then 'loan_out'::public.transaction_type
           else 'loan_in'::public.transaction_type end,
      p_principal, v_start,
      'Loan ' || case when p_direction = 'given' then 'given to ' else 'received from ' end || btrim(p_counterparty),
      p_idempotency_key
    );
  end if;

  return v_loan;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_loan_repayment: the atomic core of the loan ledger.
--   * locks the loan row so two concurrent payments cannot both pass the balance check;
--   * writes the cash transaction, the repayment row and the outstanding update together.
-- ---------------------------------------------------------------------------
create or replace function public.record_loan_repayment(
  p_loan_id uuid,
  p_account_id uuid,
  p_principal numeric,
  p_interest numeric,
  p_paid_on date,
  p_idempotency_key uuid
)
returns public.loan_repayments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_loan public.loans;
  v_rep public.loan_repayments;
  v_tx public.transactions;
  v_interest numeric := coalesce(p_interest, 0);
  v_principal numeric := coalesce(p_principal, 0);
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select * into v_rep from public.loan_repayments r
  where r.user_id = v_uid and r.idempotency_key = p_idempotency_key;
  if found then
    return v_rep;
  end if;

  select * into v_loan from public.loans l
  where l.id = p_loan_id and l.user_id = v_uid
  for update;
  if not found then
    raise exception 'loan not found' using errcode = 'P0002';
  end if;

  if v_loan.status = 'settled' then
    raise exception 'loan is already settled' using errcode = '23514';
  end if;
  if v_principal < 0 or v_interest < 0 or v_principal + v_interest <= 0 then
    raise exception 'repayment amounts must be non-negative and not both zero' using errcode = '23514';
  end if;
  if v_principal > v_loan.outstanding_principal then
    raise exception 'principal % exceeds outstanding balance %', v_principal, v_loan.outstanding_principal
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = p_account_id and a.user_id = v_uid and not a.is_archived
  ) then
    raise exception 'account not found or archived' using errcode = 'P0002';
  end if;

  insert into public.transactions (
    user_id, account_id, loan_id, type, amount, occurred_on, description, idempotency_key
  )
  values (
    v_uid, p_account_id, v_loan.id,
    case when v_loan.direction = 'given' then 'loan_repayment_in'::public.transaction_type
           else 'loan_repayment_out'::public.transaction_type end,
    v_principal + v_interest, coalesce(p_paid_on, current_date),
    'Loan repayment: ' || v_loan.counterparty,
    p_idempotency_key
  )
  returning * into v_tx;

  insert into public.loan_repayments (
    user_id, loan_id, account_id, transaction_id,
    principal_amount, interest_amount, paid_on, idempotency_key
  )
  values (
    v_uid, v_loan.id, p_account_id, v_tx.id,
    v_principal, v_interest, coalesce(p_paid_on, current_date), p_idempotency_key
  )
  returning * into v_rep;

  update public.loans
  set outstanding_principal = outstanding_principal - v_principal,
      status = case when outstanding_principal - v_principal = 0 then 'settled'::public.loan_status
                    else 'active'::public.loan_status end
  where id = v_loan.id;

  return v_rep;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing for PUBLIC or anon, execute for signed-in users only.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_transaction(uuid, public.transaction_type, numeric, date, uuid, text, uuid) from public, anon;
revoke execute on function public.create_transfer(uuid, uuid, numeric, date, text, uuid) from public, anon;
revoke execute on function public.create_loan(public.loan_direction, text, numeric, date, date, uuid, text, uuid) from public, anon;
revoke execute on function public.record_loan_repayment(uuid, uuid, numeric, numeric, date, uuid) from public, anon;
revoke execute on function public.report_monthly_summary(int) from public, anon;

grant execute on function public.create_transaction(uuid, public.transaction_type, numeric, date, uuid, text, uuid) to authenticated;
grant execute on function public.create_transfer(uuid, uuid, numeric, date, text, uuid) to authenticated;
grant execute on function public.create_loan(public.loan_direction, text, numeric, date, date, uuid, text, uuid) to authenticated;
grant execute on function public.record_loan_repayment(uuid, uuid, numeric, numeric, date, uuid) to authenticated;
