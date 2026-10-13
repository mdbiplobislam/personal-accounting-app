-- Migration 001: enumerated types used by the accounting schema.
-- Enum values are append-only: never rename or remove a value in an applied migration.

create type public.account_type as enum (
  'cash',
  'bank',
  'bkash',
  'nagad',
  'rocket',
  'credit_card',
  'other'
);

create type public.category_kind as enum ('income', 'expense');

-- Money-movement classification. Only 'income' and 'refund' style rows that touch
-- 'income'/'expense' categories feed reports; loan_* rows move cash but are never
-- income or expense. Transfers are a separate table and are never income or expense.
create type public.transaction_type as enum (
  'income',
  'expense',
  'refund',
  'loan_out',
  'loan_in',
  'loan_repayment_in',
  'loan_repayment_out'
);

create type public.loan_direction as enum ('given', 'received');

create type public.loan_status as enum ('active', 'settled');
