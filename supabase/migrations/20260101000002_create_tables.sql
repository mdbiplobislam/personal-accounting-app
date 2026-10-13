-- Migration 002: core tables.
--
-- Conventions
--   * Money is NUMERIC(14,2). Currency defaults to BDT.
--   * Every user-owned table carries user_id. Child rows reference parents through
--     composite foreign keys (parent_id, user_id) so a row can never point at another
--     user's account/category/loan even if a client bypasses RLS.
--   * Balances are never stored on accounts; they are derived in the account_balances
--     view from opening_balance + transactions + transfers (see migration 005).

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger (migration 004).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 100),
  default_currency char(3) not null default 'BDT' check (default_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- accounts: cash, bank, mobile wallets (bKash/Nagad/Rocket) and credit cards.
-- opening_balance is signed. For a credit card a negative value means "amount owed".
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  type public.account_type not null,
  currency char(3) not null default 'BDT' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(14, 2) not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_id_user_key unique (id, user_id)
);

create unique index accounts_user_name_key on public.accounts (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- categories: income or expense buckets. Deleting a category that is in use is
-- blocked by the foreign key (no ON DELETE action) — archive by renaming instead.
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind public.category_kind not null,
  created_at timestamptz not null default now(),
  constraint categories_id_user_key unique (id, user_id)
);

create unique index categories_user_kind_name_key on public.categories (user_id, kind, lower(name));

-- ---------------------------------------------------------------------------
-- loans: money lent out ('given') or borrowed ('received').
-- outstanding_principal only changes through record_loan_repayment() (migration 005).
-- ---------------------------------------------------------------------------
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  direction public.loan_direction not null,
  counterparty text not null check (char_length(btrim(counterparty)) between 1 and 100),
  principal numeric(14, 2) not null check (principal > 0),
  outstanding_principal numeric(14, 2) not null,
  status public.loan_status not null default 'active',
  start_date date not null default current_date,
  due_date date,
  notes text check (notes is null or char_length(notes) <= 500),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loans_id_user_key unique (id, user_id),
  constraint loans_idempotency_key unique (user_id, idempotency_key),
  constraint loans_outstanding_range_chk check (outstanding_principal >= 0 and outstanding_principal <= principal),
  constraint loans_status_chk check ((status = 'settled') = (outstanding_principal = 0)),
  constraint loans_due_date_chk check (due_date is null or due_date >= start_date)
);

create index loans_user_status_idx on public.loans (user_id, status);

-- ---------------------------------------------------------------------------
-- transactions: income, expense, refund and loan cash movements.
--   signed_amount: + for money in, - for money out (drives balances).
--   idempotency_key: client-generated UUID; a retried submit returns the original row.
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_id uuid not null,
  category_id uuid,
  loan_id uuid,
  type public.transaction_type not null,
  amount numeric(14, 2) not null check (amount > 0),
  signed_amount numeric(14, 2) generated always as (
    case
      when type in ('income', 'refund', 'loan_in', 'loan_repayment_in') then amount
      else -amount
    end
  ) stored,
  occurred_on date not null default current_date,
  description text check (description is null or char_length(description) <= 255),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_id_user_key unique (id, user_id),
  constraint transactions_idempotency_key unique (user_id, idempotency_key),
  constraint transactions_account_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id),
  constraint transactions_category_fk foreign key (category_id, user_id)
    references public.categories (id, user_id),
  constraint transactions_loan_fk foreign key (loan_id, user_id)
    references public.loans (id, user_id),
  -- loan_id is present exactly when the row is a loan cash movement.
  constraint transactions_loan_link_chk check (
    (loan_id is not null) = (type in ('loan_out', 'loan_in', 'loan_repayment_in', 'loan_repayment_out'))
  ),
  -- Loan movements never carry an income/expense category.
  constraint transactions_loan_category_chk check (
    category_id is null or type in ('income', 'expense', 'refund')
  )
);

create index transactions_user_date_idx on public.transactions (user_id, occurred_on desc);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_category_idx on public.transactions (category_id);
create index transactions_loan_idx on public.transactions (loan_id);

-- ---------------------------------------------------------------------------
-- transfers: money moved between two of the user's own accounts.
-- Deliberately NOT a transactions row, so it can never be counted as income/expense.
-- ---------------------------------------------------------------------------
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_account_id uuid not null,
  to_account_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  transferred_on date not null default current_date,
  note text check (note is null or char_length(note) <= 255),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transfers_id_user_key unique (id, user_id),
  constraint transfers_idempotency_key unique (user_id, idempotency_key),
  constraint transfers_from_fk foreign key (from_account_id, user_id)
    references public.accounts (id, user_id),
  constraint transfers_to_fk foreign key (to_account_id, user_id)
    references public.accounts (id, user_id),
  constraint transfers_distinct_accounts_chk check (from_account_id <> to_account_id)
);

create index transfers_user_date_idx on public.transfers (user_id, transferred_on desc);

-- ---------------------------------------------------------------------------
-- loan_repayments: immutable record of a payment against a loan.
-- Each repayment has exactly one matching transactions row (transaction_id).
-- ---------------------------------------------------------------------------
create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  loan_id uuid not null,
  account_id uuid not null,
  transaction_id uuid not null,
  principal_amount numeric(14, 2) not null check (principal_amount >= 0),
  interest_amount numeric(14, 2) not null default 0 check (interest_amount >= 0),
  paid_on date not null default current_date,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint loan_repayments_id_user_key unique (id, user_id),
  constraint loan_repayments_idempotency_key unique (user_id, idempotency_key),
  constraint loan_repayments_transaction_key unique (transaction_id),
  constraint loan_repayments_amount_chk check (principal_amount + interest_amount > 0),
  constraint loan_repayments_loan_fk foreign key (loan_id, user_id)
    references public.loans (id, user_id),
  constraint loan_repayments_account_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id),
  constraint loan_repayments_transaction_fk foreign key (transaction_id, user_id)
    references public.transactions (id, user_id)
);

create index loan_repayments_loan_idx on public.loan_repayments (loan_id);

-- ---------------------------------------------------------------------------
-- budgets: monthly spending limit per expense category.
-- month is always the first day of the month.
-- ---------------------------------------------------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_id_user_key unique (id, user_id),
  constraint budgets_category_month_key unique (user_id, category_id, month),
  constraint budgets_category_fk foreign key (category_id, user_id)
    references public.categories (id, user_id)
);

-- ---------------------------------------------------------------------------
-- savings_goals: target plus manually recorded progress.
-- ---------------------------------------------------------------------------
create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  target_amount numeric(14, 2) not null check (target_amount > 0),
  saved_amount numeric(14, 2) not null default 0 check (saved_amount >= 0),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint savings_goals_id_user_key unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- audit_logs: append-only row history, written by triggers (migration 003).
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_user_created_idx on public.audit_logs (user_id, created_at desc);
