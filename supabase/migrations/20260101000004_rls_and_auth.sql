-- Migration 004: Row Level Security, grants and the signup trigger.
--
-- Access model
--   * Every user table has RLS enabled. Policies compare user_id to auth.uid().
--   * loans, loan_repayments and audit_logs are read-only for clients. Their writes go
--     through the security-definer RPCs in migration 005, which validate ownership.
--   * Loan-linked transactions cannot be inserted, updated or deleted directly, so a
--     loan's cash trail can only change through the loan functions.

-- ---------------------------------------------------------------------------
-- Signup: create the profile and a starter set of categories for each auth user.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );

  insert into public.categories (user_id, name, kind) values
    (new.id, 'Salary', 'income'),
    (new.id, 'Business', 'income'),
    (new.id, 'Other income', 'income'),
    (new.id, 'Food', 'expense'),
    (new.id, 'Transport', 'expense'),
    (new.id, 'Rent', 'expense'),
    (new.id, 'Utilities', 'expense'),
    (new.id, 'Mobile recharge', 'expense'),
    (new.id, 'Healthcare', 'expense'),
    (new.id, 'Education', 'expense'),
    (new.id, 'Shopping', 'expense'),
    (new.id, 'Entertainment', 'expense'),
    (new.id, 'Other expense', 'expense');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Enable RLS on every application table.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.loans enable row level security;
alter table public.transactions enable row level security;
alter table public.transfers enable row level security;
alter table public.loan_repayments enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: read and edit own profile. Created only by handle_new_user().
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- accounts / categories / budgets / savings_goals / transfers: full CRUD on own rows.
-- ---------------------------------------------------------------------------
create policy accounts_select_own on public.accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy accounts_insert_own on public.accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy accounts_update_own on public.accounts
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy accounts_delete_own on public.accounts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy categories_select_own on public.categories
  for select to authenticated using (user_id = (select auth.uid()));
create policy categories_insert_own on public.categories
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy categories_update_own on public.categories
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy categories_delete_own on public.categories
  for delete to authenticated using (user_id = (select auth.uid()));

create policy transfers_select_own on public.transfers
  for select to authenticated using (user_id = (select auth.uid()));
create policy transfers_insert_own on public.transfers
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy transfers_update_own on public.transfers
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy transfers_delete_own on public.transfers
  for delete to authenticated using (user_id = (select auth.uid()));

create policy budgets_select_own on public.budgets
  for select to authenticated using (user_id = (select auth.uid()));
create policy budgets_insert_own on public.budgets
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy budgets_update_own on public.budgets
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy budgets_delete_own on public.budgets
  for delete to authenticated using (user_id = (select auth.uid()));

create policy savings_goals_select_own on public.savings_goals
  for select to authenticated using (user_id = (select auth.uid()));
create policy savings_goals_insert_own on public.savings_goals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy savings_goals_update_own on public.savings_goals
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy savings_goals_delete_own on public.savings_goals
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- transactions: own rows only. Loan-linked types are excluded from every
-- client-facing write policy; only the loan RPCs may create them.
-- ---------------------------------------------------------------------------
create policy transactions_select_own on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));

create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and type in ('income', 'expense', 'refund')
  );

create policy transactions_update_own on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid()) and type in ('income', 'expense', 'refund'))
  with check (user_id = (select auth.uid()) and type in ('income', 'expense', 'refund'));

create policy transactions_delete_own on public.transactions
  for delete to authenticated
  using (user_id = (select auth.uid()) and type in ('income', 'expense', 'refund'));

-- ---------------------------------------------------------------------------
-- Read-only for clients.
-- ---------------------------------------------------------------------------
create policy loans_select_own on public.loans
  for select to authenticated using (user_id = (select auth.uid()));

create policy loan_repayments_select_own on public.loan_repayments
  for select to authenticated using (user_id = (select auth.uid()));

create policy audit_logs_select_own on public.audit_logs
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants. Supabase applies default grants, but declaring them keeps a plain
-- PostgreSQL database (used by the CI schema tests) identical in behaviour.
-- anon never gets table access.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.transfers to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.savings_goals to authenticated;
grant select on public.loans to authenticated;
grant select on public.loan_repayments to authenticated;
grant select on public.audit_logs to authenticated;

-- Function execute rights are granted explicitly in migration 005 after each RPC exists.
